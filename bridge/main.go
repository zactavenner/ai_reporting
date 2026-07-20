// HPA WhatsApp bridge — whatsmeow (Go) implementation.
// Same HTTP contract as the previous Baileys bridge so the Lovable edge
// functions (whatsapp-send / whatsapp-status / whatsapp-inbound) work unchanged.
package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "github.com/mattn/go-sqlite3"
	qrcode "github.com/skip2/go-qrcode"
	"go.mau.fi/whatsmeow"
	waProto "go.mau.fi/whatsmeow/binary/proto"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
	"google.golang.org/protobuf/proto"
)

type appState struct {
	mu           sync.RWMutex
	client       *whatsmeow.Client
	status       string
	phoneNumber  string
	lastQR       string
	lastQRAt     time.Time
	sessionLabel string
	webhookURL   string
	webhookSec   string
	bridgeToken  string
	authDir      string
}

var state = &appState{status: "disconnected"}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func mustEnv(k string) string {
	v := os.Getenv(k)
	if v == "" {
		log.Fatalf("%s env required", k)
	}
	return v
}

func postWebhook(event string, payload map[string]any) {
	if state.webhookURL == "" || state.webhookSec == "" {
		return
	}
	body, _ := json.Marshal(map[string]any{
		"event":         event,
		"session_label": state.sessionLabel,
		"payload":       payload,
	})
	req, err := http.NewRequest("POST", state.webhookURL, bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-bridge-secret", state.webhookSec)
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("webhook post failed: %v", err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		log.Printf("webhook non-2xx: %d %s", resp.StatusCode, string(b))
	}
}

func extractBody(m *waProto.Message) (body, mtype, mime string) {
	if m == nil {
		return "", "other", ""
	}
	switch {
	case m.Conversation != nil:
		return m.GetConversation(), "text", ""
	case m.ExtendedTextMessage != nil:
		return m.ExtendedTextMessage.GetText(), "text", ""
	case m.ImageMessage != nil:
		return m.ImageMessage.GetCaption(), "image", m.ImageMessage.GetMimetype()
	case m.VideoMessage != nil:
		return m.VideoMessage.GetCaption(), "video", m.VideoMessage.GetMimetype()
	case m.AudioMessage != nil:
		return "", "audio", m.AudioMessage.GetMimetype()
	case m.DocumentMessage != nil:
		return m.DocumentMessage.GetFileName(), "document", m.DocumentMessage.GetMimetype()
	}
	return "", "other", ""
}

func handleEvent(evt any) {
	switch v := evt.(type) {
	case *events.Connected:
		phone := ""
		if state.client != nil && state.client.Store != nil && state.client.Store.ID != nil {
			phone = state.client.Store.ID.User
		}
		state.mu.Lock()
		state.status = "connected"
		state.lastQR = ""
		state.phoneNumber = phone
		state.mu.Unlock()
		log.Printf("connected as %s", phone)
		postWebhook("connection", map[string]any{"status": "connected", "phone_number": phone})
	case *events.Disconnected:
		state.mu.Lock()
		state.status = "disconnected"
		state.mu.Unlock()
		postWebhook("connection", map[string]any{"status": "disconnected"})
	case *events.LoggedOut:
		state.mu.Lock()
		state.status = "logged_out"
		state.mu.Unlock()
		postWebhook("connection", map[string]any{"status": "logged_out"})
	case *events.Message:
		body, mtype, mime := extractBody(v.Message)
		jid := v.Info.Chat.String()
		isGroup := v.Info.Chat.Server == types.GroupServer
		direction := "inbound"
		if v.Info.IsFromMe {
			direction = "outbound"
		}
		payload := map[string]any{
			"jid":           jid,
			"wa_message_id": v.Info.ID,
			"direction":     direction,
			"body":          body,
			"message_type":  mtype,
			"media_mime":    mime,
			"sender_jid":    v.Info.Sender.String(),
			"push_name":     v.Info.PushName,
			"is_group":      isGroup,
			"wa_timestamp":  v.Info.Timestamp.UTC().Format(time.RFC3339),
		}
		postWebhook("message", payload)
	}
}

func startClient(ctx context.Context) error {
	if err := os.MkdirAll(state.authDir, 0o755); err != nil {
		return err
	}
	dbPath := filepath.Join(state.authDir, "whatsmeow.db")
	logger := waLog.Stdout("wm", "INFO", true)
	container, err := sqlstore.New(ctx, "sqlite3", "file:"+dbPath+"?_foreign_keys=on", logger)
	if err != nil {
		return fmt.Errorf("sqlstore: %w", err)
	}
	deviceStore, err := container.GetFirstDevice(ctx)
	if err != nil {
		return fmt.Errorf("get device: %w", err)
	}
	cli := whatsmeow.NewClient(deviceStore, logger)
	cli.EnableAutoReconnect = true
	cli.AddEventHandler(handleEvent)
	state.mu.Lock()
	state.client = cli
	state.status = "connecting"
	state.mu.Unlock()

	if cli.Store.ID == nil {
		qrChan, err := cli.GetQRChannel(ctx)
		if err != nil {
			return fmt.Errorf("qr chan: %w", err)
		}
		if err := cli.Connect(); err != nil {
			return fmt.Errorf("connect: %w", err)
		}
		go func() {
			for evt := range qrChan {
				if evt.Event == "code" {
					png, err := qrcode.Encode(evt.Code, qrcode.Medium, 256)
					if err == nil {
						dataURL := "data:image/png;base64," + base64.StdEncoding.EncodeToString(png)
						state.mu.Lock()
						state.status = "qr"
						state.lastQR = dataURL
						state.lastQRAt = time.Now().UTC()
						state.mu.Unlock()
						log.Printf("QR ready — scan from WhatsApp → Linked Devices")
						postWebhook("qr", map[string]any{"qr": dataURL})
					}
				} else {
					log.Printf("pairing evt: %s", evt.Event)
				}
			}
		}()
	} else {
		if err := cli.Connect(); err != nil {
			return fmt.Errorf("connect existing: %w", err)
		}
	}
	return nil
}

func auth(w http.ResponseWriter, r *http.Request) bool {
	if r.Header.Get("Authorization") != "Bearer "+state.bridgeToken {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func healthHandler(w http.ResponseWriter, _ *http.Request) {
	state.mu.RLock()
	defer state.mu.RUnlock()
	writeJSON(w, 200, map[string]any{"ok": true, "status": state.status})
}

func statusHandler(w http.ResponseWriter, r *http.Request) {
	if !auth(w, r) {
		return
	}
	state.mu.RLock()
	defer state.mu.RUnlock()
	var qrAt any
	if !state.lastQRAt.IsZero() {
		qrAt = state.lastQRAt.Format(time.RFC3339)
	}
	var qr any
	if state.lastQR != "" {
		qr = state.lastQR
	}
	writeJSON(w, 200, map[string]any{
		"status":       state.status,
		"phone_number": state.phoneNumber,
		"qr":           qr,
		"qr_at":        qrAt,
	})
}

type sendReq struct {
	JID     string `json:"jid"`
	Message string `json:"message"`
}

func sendHandler(w http.ResponseWriter, r *http.Request) {
	if !auth(w, r) {
		return
	}
	var body sendReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid json"})
		return
	}
	if body.JID == "" || body.Message == "" {
		writeJSON(w, 400, map[string]string{"error": "jid and message required"})
		return
	}
	state.mu.RLock()
	cli := state.client
	st := state.status
	state.mu.RUnlock()
	if cli == nil || st != "connected" {
		writeJSON(w, 503, map[string]string{"error": "not connected"})
		return
	}
	target := body.JID
	if !strings.Contains(target, "@") {
		digits := strings.Map(func(r rune) rune {
			if r >= '0' && r <= '9' {
				return r
			}
			return -1
		}, target)
		target = digits + "@s.whatsapp.net"
	}
	jid, err := types.ParseJID(target)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "bad jid: " + err.Error()})
		return
	}
	msg := &waProto.Message{Conversation: proto.String(body.Message)}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	resp, err := cli.SendMessage(ctx, jid, msg)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "wa_message_id": resp.ID})
}

func logoutHandler(w http.ResponseWriter, r *http.Request) {
	if !auth(w, r) {
		return
	}
	state.mu.RLock()
	cli := state.client
	state.mu.RUnlock()
	if cli == nil {
		writeJSON(w, 200, map[string]any{"ok": true})
		return
	}
	if err := cli.Logout(r.Context()); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func resetHandler(w http.ResponseWriter, r *http.Request) {
	if !auth(w, r) {
		return
	}
	state.mu.RLock()
	cli := state.client
	state.mu.RUnlock()
	if cli != nil {
		cli.Disconnect()
	}
	_ = os.Remove(filepath.Join(state.authDir, "whatsmeow.db"))
	state.mu.Lock()
	state.status = "disconnected"
	state.lastQR = ""
	state.phoneNumber = ""
	state.mu.Unlock()
	go func() {
		if err := startClient(context.Background()); err != nil {
			log.Printf("restart after reset: %v", err)
		}
	}()
	writeJSON(w, 200, map[string]any{"ok": true})
}

func main() {
	state.bridgeToken = mustEnv("BRIDGE_TOKEN")
	state.webhookURL = os.Getenv("LOVABLE_WEBHOOK_URL")
	state.webhookSec = os.Getenv("WEBHOOK_SECRET")
	state.sessionLabel = env("SESSION_LABEL", "default")
	state.authDir = env("AUTH_DIR", "./auth")
	port := env("PORT", "8080")

	if state.webhookURL == "" || state.webhookSec == "" {
		log.Printf("WARN: LOVABLE_WEBHOOK_URL / WEBHOOK_SECRET not set — webhooks disabled")
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/status", statusHandler)
	mux.HandleFunc("/send", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", 405)
			return
		}
		sendHandler(w, r)
	})
	mux.HandleFunc("/logout", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", 405)
			return
		}
		logoutHandler(w, r)
	})
	mux.HandleFunc("/reset", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", 405)
			return
		}
		resetHandler(w, r)
	})

	go func() {
		if err := startClient(context.Background()); err != nil {
			log.Printf("start failed: %v", err)
		}
	}()

	log.Printf("bridge listening on :%s (session=%s)", port, state.sessionLabel)
	srv := &http.Server{Addr: ":" + port, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("http: %v", err)
	}
}