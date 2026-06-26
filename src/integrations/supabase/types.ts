export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      ad_iterations: {
        Row: {
          asset_id: string | null
          client_id: string | null
          copy_body: string | null
          copy_cta: string | null
          copy_headline: string | null
          created_at: string | null
          creative_id: string | null
          id: string
          image_url: string | null
          iteration_number: number | null
          iteration_type: string | null
          metadata: Json | null
          notes: string | null
          performance_score: number | null
          prompt: string | null
          source_ad_id: string | null
          status: string | null
          video_url: string | null
        }
        Insert: {
          asset_id?: string | null
          client_id?: string | null
          copy_body?: string | null
          copy_cta?: string | null
          copy_headline?: string | null
          created_at?: string | null
          creative_id?: string | null
          id?: string
          image_url?: string | null
          iteration_number?: number | null
          iteration_type?: string | null
          metadata?: Json | null
          notes?: string | null
          performance_score?: number | null
          prompt?: string | null
          source_ad_id?: string | null
          status?: string | null
          video_url?: string | null
        }
        Update: {
          asset_id?: string | null
          client_id?: string | null
          copy_body?: string | null
          copy_cta?: string | null
          copy_headline?: string | null
          created_at?: string | null
          creative_id?: string | null
          id?: string
          image_url?: string | null
          iteration_number?: number | null
          iteration_type?: string | null
          metadata?: Json | null
          notes?: string | null
          performance_score?: number | null
          prompt?: string | null
          source_ad_id?: string | null
          status?: string | null
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_iterations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "ad_iterations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_iterations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "ad_iterations_creative_id_fkey"
            columns: ["creative_id"]
            isOneToOne: false
            referencedRelation: "creatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_iterations_source_ad_id_fkey"
            columns: ["source_ad_id"]
            isOneToOne: false
            referencedRelation: "scraped_ads"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_scripts: {
        Row: {
          ad_format: string | null
          angle: string | null
          approved_at: string | null
          approved_by: string | null
          body: string | null
          body_copy: string | null
          body_variants: Json | null
          brief_id: string | null
          client_id: string
          created_at: string
          cta: string | null
          duration_seconds: number | null
          generated_by: string | null
          headline: string | null
          headlines: Json | null
          hook: string | null
          id: string
          linked_meta_ad_id: string | null
          notes: string | null
          performance_metrics: Json | null
          platform: string | null
          rejection_reason: string | null
          script_body: string | null
          script_type: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          ad_format?: string | null
          angle?: string | null
          approved_at?: string | null
          approved_by?: string | null
          body?: string | null
          body_copy?: string | null
          body_variants?: Json | null
          brief_id?: string | null
          client_id: string
          created_at?: string
          cta?: string | null
          duration_seconds?: number | null
          generated_by?: string | null
          headline?: string | null
          headlines?: Json | null
          hook?: string | null
          id?: string
          linked_meta_ad_id?: string | null
          notes?: string | null
          performance_metrics?: Json | null
          platform?: string | null
          rejection_reason?: string | null
          script_body?: string | null
          script_type?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          ad_format?: string | null
          angle?: string | null
          approved_at?: string | null
          approved_by?: string | null
          body?: string | null
          body_copy?: string | null
          body_variants?: Json | null
          brief_id?: string | null
          client_id?: string
          created_at?: string
          cta?: string | null
          duration_seconds?: number | null
          generated_by?: string | null
          headline?: string | null
          headlines?: Json | null
          hook?: string | null
          id?: string
          linked_meta_ad_id?: string | null
          notes?: string | null
          performance_metrics?: Json | null
          platform?: string | null
          rejection_reason?: string | null
          script_body?: string | null
          script_type?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_scripts_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "agency_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_scripts_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "creative_briefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_scripts_linked_meta_ad_id_fkey"
            columns: ["linked_meta_ad_id"]
            isOneToOne: false
            referencedRelation: "meta_ads"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_spend_reports: {
        Row: {
          ad_set_name: string | null
          campaign_name: string | null
          clicks: number | null
          client_id: string
          created_at: string | null
          id: string
          impressions: number | null
          platform: string | null
          reported_at: string
          spend: number | null
        }
        Insert: {
          ad_set_name?: string | null
          campaign_name?: string | null
          clicks?: number | null
          client_id: string
          created_at?: string | null
          id?: string
          impressions?: number | null
          platform?: string | null
          reported_at: string
          spend?: number | null
        }
        Update: {
          ad_set_name?: string | null
          campaign_name?: string | null
          clicks?: number | null
          client_id?: string
          created_at?: string | null
          id?: string
          impressions?: number | null
          platform?: string | null
          reported_at?: string
          spend?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_spend_reports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "ad_spend_reports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_spend_reports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      ad_styles: {
        Row: {
          canva_url: string | null
          client_id: string | null
          created_at: string | null
          description: string | null
          display_order: number | null
          example_image_url: string | null
          id: string
          is_active: boolean | null
          is_default: boolean | null
          name: string
          prompt_template: string | null
          reference_images: string[] | null
          style_config: Json | null
          thumbnail_url: string | null
        }
        Insert: {
          canva_url?: string | null
          client_id?: string | null
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          example_image_url?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          name: string
          prompt_template?: string | null
          reference_images?: string[] | null
          style_config?: Json | null
          thumbnail_url?: string | null
        }
        Update: {
          canva_url?: string | null
          client_id?: string | null
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          example_image_url?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          name?: string
          prompt_template?: string | null
          reference_images?: string[] | null
          style_config?: Json | null
          thumbnail_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_styles_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "ad_styles_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_styles_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      ad_templates: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          platform: string
          template_data: Json | null
          thumbnail_url: string | null
          type: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          platform?: string
          template_data?: Json | null
          thumbnail_url?: string | null
          type?: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          platform?: string
          template_data?: Json | null
          thumbnail_url?: string | null
          type?: string
        }
        Relationships: []
      }
      agency_agent_training: {
        Row: {
          agent_id: string
          body: string | null
          created_at: string
          created_by: string | null
          file_url: string | null
          id: string
          kind: string
          title: string
          updated_at: string
          weight: number
        }
        Insert: {
          agent_id: string
          body?: string | null
          created_at?: string
          created_by?: string | null
          file_url?: string | null
          id?: string
          kind?: string
          title: string
          updated_at?: string
          weight?: number
        }
        Update: {
          agent_id?: string
          body?: string | null
          created_at?: string
          created_by?: string | null
          file_url?: string | null
          id?: string
          kind?: string
          title?: string
          updated_at?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "agency_agent_training_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agency_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_agents: {
        Row: {
          allowed_creative_types: string[]
          created_at: string
          default_model: string
          icon: string | null
          id: string
          is_active: boolean
          name: string
          role: string
          slug: string
          sort_order: number
          system_prompt: string
          updated_at: string
        }
        Insert: {
          allowed_creative_types?: string[]
          created_at?: string
          default_model?: string
          icon?: string | null
          id?: string
          is_active?: boolean
          name: string
          role: string
          slug: string
          sort_order?: number
          system_prompt?: string
          updated_at?: string
        }
        Update: {
          allowed_creative_types?: string[]
          created_at?: string
          default_model?: string
          icon?: string | null
          id?: string
          is_active?: boolean
          name?: string
          role?: string
          slug?: string
          sort_order?: number
          system_prompt?: string
          updated_at?: string
        }
        Relationships: []
      }
      agency_meetings: {
        Row: {
          action_items: Json | null
          client_id: string | null
          created_at: string
          duration_minutes: number | null
          highlights: Json | null
          id: string
          meetgeek_url: string | null
          meeting_date: string | null
          meeting_id: string
          participants: Json | null
          recording_url: string | null
          summary: string | null
          title: string
          transcript: string | null
        }
        Insert: {
          action_items?: Json | null
          client_id?: string | null
          created_at?: string
          duration_minutes?: number | null
          highlights?: Json | null
          id?: string
          meetgeek_url?: string | null
          meeting_date?: string | null
          meeting_id: string
          participants?: Json | null
          recording_url?: string | null
          summary?: string | null
          title: string
          transcript?: string | null
        }
        Update: {
          action_items?: Json | null
          client_id?: string | null
          created_at?: string
          duration_minutes?: number | null
          highlights?: Json | null
          id?: string
          meetgeek_url?: string | null
          meeting_date?: string | null
          meeting_id?: string
          participants?: Json | null
          recording_url?: string | null
          summary?: string | null
          title?: string
          transcript?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agency_meetings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "agency_meetings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agency_meetings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      agency_members: {
        Row: {
          created_at: string
          email: string
          id: string
          last_login_at: string | null
          name: string
          phone: string | null
          pod_id: string | null
          role: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          last_login_at?: string | null
          name: string
          phone?: string | null
          pod_id?: string | null
          role?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          last_login_at?: string | null
          name?: string
          phone?: string | null
          pod_id?: string | null
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_members_pod_id_fkey"
            columns: ["pod_id"]
            isOneToOne: false
            referencedRelation: "agency_pods"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_pods: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      agency_references: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          kind: string
          mime: string | null
          name: string
          notes: string | null
          tags: string[] | null
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          mime?: string | null
          name: string
          notes?: string | null
          tags?: string[] | null
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          mime?: string | null
          name?: string
          notes?: string | null
          tags?: string[] | null
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      agency_settings: {
        Row: {
          agent_notification_slack_dm: boolean | null
          ai_prompt_agency: string | null
          ai_prompt_client: string | null
          anthropic_api_key: string | null
          api_usage_limit: number | null
          created_at: string
          eod_send_to_hermes: boolean | null
          gemini_api_key: string | null
          hermes_api_key: string | null
          hermes_callback_url: string | null
          hermes_enabled: boolean
          id: string
          kpi_google_doc_url: string | null
          kpi_google_sheet_url: string | null
          master_default_gid: string | null
          master_google_sheet_url: string | null
          master_pinned_gids: Json
          meetgeek_api_key: string | null
          meetgeek_webhook_secret: string | null
          openai_api_key: string | null
          password_hash: string | null
          selected_gemini_model: string | null
          selected_grok_model: string | null
          selected_openai_model: string | null
          slack_dm_user_id: string | null
          standup_slack_channel_id: string | null
          twilio_whatsapp_from: string | null
          updated_at: string
          whatsapp_default_recipients: string[]
          whatsapp_owner_number: string | null
          xai_api_key: string | null
        }
        Insert: {
          agent_notification_slack_dm?: boolean | null
          ai_prompt_agency?: string | null
          ai_prompt_client?: string | null
          anthropic_api_key?: string | null
          api_usage_limit?: number | null
          created_at?: string
          eod_send_to_hermes?: boolean | null
          gemini_api_key?: string | null
          hermes_api_key?: string | null
          hermes_callback_url?: string | null
          hermes_enabled?: boolean
          id?: string
          kpi_google_doc_url?: string | null
          kpi_google_sheet_url?: string | null
          master_default_gid?: string | null
          master_google_sheet_url?: string | null
          master_pinned_gids?: Json
          meetgeek_api_key?: string | null
          meetgeek_webhook_secret?: string | null
          openai_api_key?: string | null
          password_hash?: string | null
          selected_gemini_model?: string | null
          selected_grok_model?: string | null
          selected_openai_model?: string | null
          slack_dm_user_id?: string | null
          standup_slack_channel_id?: string | null
          twilio_whatsapp_from?: string | null
          updated_at?: string
          whatsapp_default_recipients?: string[]
          whatsapp_owner_number?: string | null
          xai_api_key?: string | null
        }
        Update: {
          agent_notification_slack_dm?: boolean | null
          ai_prompt_agency?: string | null
          ai_prompt_client?: string | null
          anthropic_api_key?: string | null
          api_usage_limit?: number | null
          created_at?: string
          eod_send_to_hermes?: boolean | null
          gemini_api_key?: string | null
          hermes_api_key?: string | null
          hermes_callback_url?: string | null
          hermes_enabled?: boolean
          id?: string
          kpi_google_doc_url?: string | null
          kpi_google_sheet_url?: string | null
          master_default_gid?: string | null
          master_google_sheet_url?: string | null
          master_pinned_gids?: Json
          meetgeek_api_key?: string | null
          meetgeek_webhook_secret?: string | null
          openai_api_key?: string | null
          password_hash?: string | null
          selected_gemini_model?: string | null
          selected_grok_model?: string | null
          selected_openai_model?: string | null
          slack_dm_user_id?: string | null
          standup_slack_channel_id?: string | null
          twilio_whatsapp_from?: string | null
          updated_at?: string
          whatsapp_default_recipients?: string[]
          whatsapp_owner_number?: string | null
          xai_api_key?: string | null
        }
        Relationships: []
      }
      agent_escalations: {
        Row: {
          agent_name: string
          category: string | null
          context: Json | null
          created_at: string | null
          description: string
          id: string
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          slack_channel: string | null
          slack_message_ts: string | null
          title: string
        }
        Insert: {
          agent_name: string
          category?: string | null
          context?: Json | null
          created_at?: string | null
          description: string
          id?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          slack_channel?: string | null
          slack_message_ts?: string | null
          title: string
        }
        Update: {
          agent_name?: string
          category?: string | null
          context?: Json | null
          created_at?: string | null
          description?: string
          id?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          slack_channel?: string | null
          slack_message_ts?: string | null
          title?: string
        }
        Relationships: []
      }
      agent_runs: {
        Row: {
          actions_taken: Json | null
          agent_id: string
          client_id: string | null
          completed_at: string | null
          cost_usd: number | null
          duration_ms: number | null
          error: string | null
          id: string
          input_summary: string | null
          input_tokens: number | null
          output_summary: string | null
          output_tokens: number | null
          started_at: string | null
          status: string
          tokens_used: number | null
        }
        Insert: {
          actions_taken?: Json | null
          agent_id: string
          client_id?: string | null
          completed_at?: string | null
          cost_usd?: number | null
          duration_ms?: number | null
          error?: string | null
          id?: string
          input_summary?: string | null
          input_tokens?: number | null
          output_summary?: string | null
          output_tokens?: number | null
          started_at?: string | null
          status?: string
          tokens_used?: number | null
        }
        Update: {
          actions_taken?: Json | null
          agent_id?: string
          client_id?: string | null
          completed_at?: string | null
          cost_usd?: number | null
          duration_ms?: number | null
          error?: string | null
          id?: string
          input_summary?: string | null
          input_tokens?: number | null
          output_summary?: string | null
          output_tokens?: number | null
          started_at?: string | null
          status?: string
          tokens_used?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "agent_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      agent_tasks: {
        Row: {
          assigned_to_agent: string
          attempts: number | null
          completed_at: string | null
          created_at: string | null
          created_by_agent: string
          due_at: string | null
          id: string
          max_attempts: number | null
          payload: Json
          priority: string | null
          result: Json | null
          started_at: string | null
          status: string | null
          task_type: string
        }
        Insert: {
          assigned_to_agent: string
          attempts?: number | null
          completed_at?: string | null
          created_at?: string | null
          created_by_agent: string
          due_at?: string | null
          id?: string
          max_attempts?: number | null
          payload?: Json
          priority?: string | null
          result?: Json | null
          started_at?: string | null
          status?: string | null
          task_type: string
        }
        Update: {
          assigned_to_agent?: string
          attempts?: number | null
          completed_at?: string | null
          created_at?: string | null
          created_by_agent?: string
          due_at?: string | null
          id?: string
          max_attempts?: number | null
          payload?: Json
          priority?: string | null
          result?: Json | null
          started_at?: string | null
          status?: string | null
          task_type?: string
        }
        Relationships: []
      }
      agents: {
        Row: {
          client_id: string | null
          connectors: Json | null
          consecutive_failures: number | null
          created_at: string
          description: string | null
          enabled: boolean | null
          icon: string | null
          id: string
          last_run_at: string | null
          last_run_status: string | null
          max_tokens: number | null
          model: string | null
          name: string
          notify_channels: string[]
          prompt_template: string
          schedule_cron: string | null
          schedule_timezone: string | null
          temperature: number | null
          template_key: string | null
          updated_at: string
          whatsapp_recipients: string[]
        }
        Insert: {
          client_id?: string | null
          connectors?: Json | null
          consecutive_failures?: number | null
          created_at?: string
          description?: string | null
          enabled?: boolean | null
          icon?: string | null
          id?: string
          last_run_at?: string | null
          last_run_status?: string | null
          max_tokens?: number | null
          model?: string | null
          name: string
          notify_channels?: string[]
          prompt_template?: string
          schedule_cron?: string | null
          schedule_timezone?: string | null
          temperature?: number | null
          template_key?: string | null
          updated_at?: string
          whatsapp_recipients?: string[]
        }
        Update: {
          client_id?: string | null
          connectors?: Json | null
          consecutive_failures?: number | null
          created_at?: string
          description?: string | null
          enabled?: boolean | null
          icon?: string | null
          id?: string
          last_run_at?: string | null
          last_run_status?: string | null
          max_tokens?: number | null
          model?: string | null
          name?: string
          notify_channels?: string[]
          prompt_template?: string
          schedule_cron?: string | null
          schedule_timezone?: string | null
          temperature?: number | null
          template_key?: string | null
          updated_at?: string
          whatsapp_recipients?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "agents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "agents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      ai_hub_conversations: {
        Row: {
          created_at: string
          gpt_id: string | null
          id: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          gpt_id?: string | null
          id?: string
          title?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          gpt_id?: string | null
          id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_hub_conversations_gpt_id_fkey"
            columns: ["gpt_id"]
            isOneToOne: false
            referencedRelation: "custom_gpts"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_hub_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_hub_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_hub_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_insights: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          body: string | null
          category: string
          client_id: string | null
          created_at: string
          id: string
          insight_date: string
          metrics: Json | null
          severity: string
          title: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          body?: string | null
          category: string
          client_id?: string | null
          created_at?: string
          id?: string
          insight_date?: string
          metrics?: Json | null
          severity?: string
          title: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          body?: string | null
          category?: string
          client_id?: string | null
          created_at?: string
          id?: string
          insight_date?: string
          metrics?: Json | null
          severity?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_insights_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "ai_insights_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_insights_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      ai_meeting_briefs: {
        Row: {
          brief_markdown: string
          client_id: string | null
          context_used: Json | null
          created_at: string
          generated_by: string | null
          id: string
          meeting_id: string | null
        }
        Insert: {
          brief_markdown: string
          client_id?: string | null
          context_used?: Json | null
          created_at?: string
          generated_by?: string | null
          id?: string
          meeting_id?: string | null
        }
        Update: {
          brief_markdown?: string
          client_id?: string | null
          context_used?: Json | null
          created_at?: string
          generated_by?: string | null
          id?: string
          meeting_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_meeting_briefs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "ai_meeting_briefs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_meeting_briefs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "ai_meeting_briefs_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "agency_meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_studio_canvas_items: {
        Row: {
          actor_member_id: string | null
          conversation_id: string
          created_at: string
          feedback_notes: string | null
          feedback_status: string
          id: string
          kind: string
          payload: Json
          reviewed_at: string | null
          reviewed_by: string | null
          user_id: string
        }
        Insert: {
          actor_member_id?: string | null
          conversation_id: string
          created_at?: string
          feedback_notes?: string | null
          feedback_status?: string
          id?: string
          kind: string
          payload?: Json
          reviewed_at?: string | null
          reviewed_by?: string | null
          user_id: string
        }
        Update: {
          actor_member_id?: string | null
          conversation_id?: string
          created_at?: string
          feedback_notes?: string | null
          feedback_status?: string
          id?: string
          kind?: string
          payload?: Json
          reviewed_at?: string | null
          reviewed_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_studio_canvas_items_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_studio_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_studio_conversations: {
        Row: {
          active_reference_ids: Json
          active_video_reference_ids: Json
          archived_at: string | null
          canvas_pan_x: number
          canvas_pan_y: number
          canvas_zoom: number
          chat_model: string | null
          cleared_at: string | null
          client_id: string
          created_at: string
          doc_url: string | null
          focused_canvas_item_id: string | null
          id: string
          image_quality: string
          is_shared: boolean
          kind: string
          last_active_at: string
          last_actor_member_id: string | null
          pinned: boolean
          sheet_url: string | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active_reference_ids?: Json
          active_video_reference_ids?: Json
          archived_at?: string | null
          canvas_pan_x?: number
          canvas_pan_y?: number
          canvas_zoom?: number
          chat_model?: string | null
          cleared_at?: string | null
          client_id: string
          created_at?: string
          doc_url?: string | null
          focused_canvas_item_id?: string | null
          id?: string
          image_quality?: string
          is_shared?: boolean
          kind?: string
          last_active_at?: string
          last_actor_member_id?: string | null
          pinned?: boolean
          sheet_url?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active_reference_ids?: Json
          active_video_reference_ids?: Json
          archived_at?: string | null
          canvas_pan_x?: number
          canvas_pan_y?: number
          canvas_zoom?: number
          chat_model?: string | null
          cleared_at?: string | null
          client_id?: string
          created_at?: string
          doc_url?: string | null
          focused_canvas_item_id?: string | null
          id?: string
          image_quality?: string
          is_shared?: boolean
          kind?: string
          last_active_at?: string
          last_actor_member_id?: string | null
          pinned?: boolean
          sheet_url?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_studio_messages: {
        Row: {
          actor_member_id: string | null
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
          tools: Json
          user_id: string
        }
        Insert: {
          actor_member_id?: string | null
          content?: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
          tools?: Json
          user_id: string
        }
        Update: {
          actor_member_id?: string | null
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
          tools?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_studio_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_studio_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_studio_reference_images: {
        Row: {
          client_id: string | null
          created_at: string
          created_by: string | null
          id: string
          image_url: string
          name: string
          source: string
          source_creative_id: string | null
          storage_path: string | null
          tags: string[] | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          image_url: string
          name: string
          source?: string
          source_creative_id?: string | null
          storage_path?: string | null
          tags?: string[] | null
        }
        Update: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          image_url?: string
          name?: string
          source?: string
          source_creative_id?: string | null
          storage_path?: string | null
          tags?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_studio_reference_images_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "ai_studio_reference_images_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_studio_reference_images_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      ai_studio_reference_videos: {
        Row: {
          aspect_ratio: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          duration_seconds: number | null
          id: string
          name: string
          notes: string | null
          poster_url: string | null
          source: string
          source_creative_id: string | null
          storage_path: string | null
          tags: string[] | null
          video_url: string
        }
        Insert: {
          aspect_ratio?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          duration_seconds?: number | null
          id?: string
          name: string
          notes?: string | null
          poster_url?: string | null
          source?: string
          source_creative_id?: string | null
          storage_path?: string | null
          tags?: string[] | null
          video_url: string
        }
        Update: {
          aspect_ratio?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          duration_seconds?: number | null
          id?: string
          name?: string
          notes?: string | null
          poster_url?: string | null
          source?: string
          source_creative_id?: string | null
          storage_path?: string | null
          tags?: string[] | null
          video_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_studio_reference_videos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "ai_studio_reference_videos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_studio_reference_videos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      ai_studio_video_model_decision_logs: {
        Row: {
          chosen_model: string | null
          client_id: string | null
          conversation_id: string | null
          created_at: string
          details: Json
          downstream_model: string | null
          event: string
          id: string
          override_reason: string | null
          requested_model: string | null
          user_id: string | null
        }
        Insert: {
          chosen_model?: string | null
          client_id?: string | null
          conversation_id?: string | null
          created_at?: string
          details?: Json
          downstream_model?: string | null
          event: string
          id?: string
          override_reason?: string | null
          requested_model?: string | null
          user_id?: string | null
        }
        Update: {
          chosen_model?: string | null
          client_id?: string | null
          conversation_id?: string | null
          created_at?: string
          details?: Json
          downstream_model?: string | null
          event?: string
          id?: string
          override_reason?: string | null
          requested_model?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_studio_video_model_decision_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "ai_studio_video_model_decision_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_studio_video_model_decision_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "ai_studio_video_model_decision_logs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_studio_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_configs: {
        Row: {
          client_id: string
          created_at: string
          enabled: boolean | null
          id: string
          metric: string
          operator: string
          slack_webhook_url: string | null
          threshold: number
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          enabled?: boolean | null
          id?: string
          metric: string
          operator: string
          slack_webhook_url?: string | null
          threshold: number
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          enabled?: boolean | null
          id?: string
          metric?: string
          operator?: string
          slack_webhook_url?: string | null
          threshold?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_configs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "alert_configs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_configs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          key_hash: string
          last_used_at: string | null
          name: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          key_hash: string
          last_used_at?: string | null
          name?: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          key_hash?: string
          last_used_at?: string | null
          name?: string
        }
        Relationships: []
      }
      api_usage: {
        Row: {
          api_name: string
          client_id: string | null
          cost_usd: number | null
          created_at: string | null
          endpoint: string | null
          id: string
          key_index: number | null
          metadata: Json | null
          request_type: string | null
          service: string | null
          status: string | null
          success: boolean | null
          tokens_used: number | null
        }
        Insert: {
          api_name: string
          client_id?: string | null
          cost_usd?: number | null
          created_at?: string | null
          endpoint?: string | null
          id?: string
          key_index?: number | null
          metadata?: Json | null
          request_type?: string | null
          service?: string | null
          status?: string | null
          success?: boolean | null
          tokens_used?: number | null
        }
        Update: {
          api_name?: string
          client_id?: string | null
          cost_usd?: number | null
          created_at?: string | null
          endpoint?: string | null
          id?: string
          key_index?: number | null
          metadata?: Json | null
          request_type?: string | null
          service?: string | null
          status?: string | null
          success?: boolean | null
          tokens_used?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "api_usage_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "api_usage_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_usage_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      apify_settings: {
        Row: {
          actor_id: string | null
          api_token: string | null
          client_id: string | null
          config: Json | null
          created_at: string | null
          current_month_spend_cents: number | null
          id: string
          is_active: boolean | null
          monthly_spend_limit_cents: number | null
          schedule: string | null
          spend_reset_date: string | null
          updated_at: string | null
        }
        Insert: {
          actor_id?: string | null
          api_token?: string | null
          client_id?: string | null
          config?: Json | null
          created_at?: string | null
          current_month_spend_cents?: number | null
          id?: string
          is_active?: boolean | null
          monthly_spend_limit_cents?: number | null
          schedule?: string | null
          spend_reset_date?: string | null
          updated_at?: string | null
        }
        Update: {
          actor_id?: string | null
          api_token?: string | null
          client_id?: string | null
          config?: Json | null
          created_at?: string | null
          current_month_spend_cents?: number | null
          id?: string
          is_active?: boolean | null
          monthly_spend_limit_cents?: number | null
          schedule?: string | null
          spend_reset_date?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "apify_settings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "apify_settings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apify_settings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      assets: {
        Row: {
          client_id: string | null
          created_at: string | null
          duration_seconds: number | null
          id: string
          metadata: Json | null
          name: string | null
          project_id: string | null
          public_url: string | null
          size_bytes: number | null
          status: string
          storage_path: string | null
          thumbnail_url: string | null
          type: string
          updated_at: string | null
          url: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          duration_seconds?: number | null
          id?: string
          metadata?: Json | null
          name?: string | null
          project_id?: string | null
          public_url?: string | null
          size_bytes?: number | null
          status?: string
          storage_path?: string | null
          thumbnail_url?: string | null
          type?: string
          updated_at?: string | null
          url?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          duration_seconds?: number | null
          id?: string
          metadata?: Json | null
          name?: string | null
          project_id?: string | null
          public_url?: string | null
          size_bytes?: number | null
          status?: string
          storage_path?: string | null
          thumbnail_url?: string | null
          type?: string
          updated_at?: string | null
          url?: string | null
        }
        Relationships: []
      }
      avatar_looks: {
        Row: {
          angle: string | null
          avatar_id: string | null
          background: string | null
          created_at: string | null
          id: string
          image_url: string
          is_default: boolean | null
          is_primary: boolean | null
          metadata: Json | null
          name: string
          outfit: string | null
          prompt: string | null
        }
        Insert: {
          angle?: string | null
          avatar_id?: string | null
          background?: string | null
          created_at?: string | null
          id?: string
          image_url: string
          is_default?: boolean | null
          is_primary?: boolean | null
          metadata?: Json | null
          name: string
          outfit?: string | null
          prompt?: string | null
        }
        Update: {
          angle?: string | null
          avatar_id?: string | null
          background?: string | null
          created_at?: string | null
          id?: string
          image_url?: string
          is_default?: boolean | null
          is_primary?: boolean | null
          metadata?: Json | null
          name?: string
          outfit?: string | null
          prompt?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "avatar_looks_avatar_id_fkey"
            columns: ["avatar_id"]
            isOneToOne: false
            referencedRelation: "avatars"
            referencedColumns: ["id"]
          },
        ]
      }
      avatars: {
        Row: {
          age_range: string | null
          base_image_url: string | null
          client_id: string | null
          created_at: string | null
          description: string | null
          elevenlabs_voice_id: string | null
          ethnicity: string | null
          gender: string | null
          id: string
          image_url: string | null
          is_active: boolean | null
          is_stock: boolean | null
          looks_count: number | null
          metadata: Json | null
          name: string
          style: string | null
        }
        Insert: {
          age_range?: string | null
          base_image_url?: string | null
          client_id?: string | null
          created_at?: string | null
          description?: string | null
          elevenlabs_voice_id?: string | null
          ethnicity?: string | null
          gender?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          is_stock?: boolean | null
          looks_count?: number | null
          metadata?: Json | null
          name: string
          style?: string | null
        }
        Update: {
          age_range?: string | null
          base_image_url?: string | null
          client_id?: string | null
          created_at?: string | null
          description?: string | null
          elevenlabs_voice_id?: string | null
          ethnicity?: string | null
          gender?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          is_stock?: boolean | null
          looks_count?: number | null
          metadata?: Json | null
          name?: string
          style?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "avatars_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "avatars_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "avatars_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      batch_jobs: {
        Row: {
          client_id: string | null
          completed_at: string | null
          completed_items: number | null
          config: Json | null
          created_at: string | null
          error_message: string | null
          failed_items: number | null
          id: string
          job_type: string
          results: Json | null
          started_at: string | null
          status: string | null
          total_items: number | null
        }
        Insert: {
          client_id?: string | null
          completed_at?: string | null
          completed_items?: number | null
          config?: Json | null
          created_at?: string | null
          error_message?: string | null
          failed_items?: number | null
          id?: string
          job_type?: string
          results?: Json | null
          started_at?: string | null
          status?: string | null
          total_items?: number | null
        }
        Update: {
          client_id?: string | null
          completed_at?: string | null
          completed_items?: number | null
          config?: Json | null
          created_at?: string | null
          error_message?: string | null
          failed_items?: number | null
          id?: string
          job_type?: string
          results?: Json | null
          started_at?: string | null
          status?: string | null
          total_items?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "batch_jobs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "batch_jobs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_jobs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      browser_tasks: {
        Row: {
          claimed_at: string | null
          claimed_by: string | null
          client_id: string
          completed_at: string | null
          created_at: string
          duration_ms: number | null
          error_message: string | null
          fulfillment_run_id: string | null
          fulfillment_step_id: string | null
          id: string
          input_data: Json
          max_retries: number | null
          offer_id: string | null
          output_data: Json | null
          priority: number | null
          retry_count: number | null
          screenshot_url: string | null
          started_at: string | null
          status: string
          task_group: string | null
          task_type: string
        }
        Insert: {
          claimed_at?: string | null
          claimed_by?: string | null
          client_id: string
          completed_at?: string | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          fulfillment_run_id?: string | null
          fulfillment_step_id?: string | null
          id?: string
          input_data?: Json
          max_retries?: number | null
          offer_id?: string | null
          output_data?: Json | null
          priority?: number | null
          retry_count?: number | null
          screenshot_url?: string | null
          started_at?: string | null
          status?: string
          task_group?: string | null
          task_type: string
        }
        Update: {
          claimed_at?: string | null
          claimed_by?: string | null
          client_id?: string
          completed_at?: string | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          fulfillment_run_id?: string | null
          fulfillment_step_id?: string | null
          id?: string
          input_data?: Json
          max_retries?: number | null
          offer_id?: string | null
          output_data?: Json | null
          priority?: number | null
          retry_count?: number | null
          screenshot_url?: string | null
          started_at?: string | null
          status?: string
          task_group?: string | null
          task_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "browser_tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "browser_tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "browser_tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "browser_tasks_fulfillment_run_id_fkey"
            columns: ["fulfillment_run_id"]
            isOneToOne: false
            referencedRelation: "fulfillment_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "browser_tasks_fulfillment_step_id_fkey"
            columns: ["fulfillment_step_id"]
            isOneToOne: false
            referencedRelation: "fulfillment_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_mappings: {
        Row: {
          calendar_id: string | null
          calendar_name: string | null
          client_id: string | null
          created_at: string | null
          funnel_id: string | null
          ghl_calendar_id: string | null
          id: string
        }
        Insert: {
          calendar_id?: string | null
          calendar_name?: string | null
          client_id?: string | null
          created_at?: string | null
          funnel_id?: string | null
          ghl_calendar_id?: string | null
          id?: string
        }
        Update: {
          calendar_id?: string | null
          calendar_name?: string | null
          client_id?: string | null
          created_at?: string | null
          funnel_id?: string | null
          ghl_calendar_id?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_mappings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "calendar_mappings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_mappings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "calendar_mappings_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
        ]
      }
      call_analysis: {
        Row: {
          action_items: Json | null
          analyzed_at: string | null
          call_date: string | null
          call_id: string
          call_type: string | null
          client_id: string | null
          close_attempted: boolean | null
          compliance_flags: Json | null
          contact_name: string | null
          created_at: string | null
          duration_seconds: number | null
          id: string
          next_step: string | null
          objections_identified: Json | null
          score_objection_handling: number | null
          score_qualification: number | null
          score_rapport: number | null
          sentiment: string | null
          summary: string | null
          transcript: string | null
        }
        Insert: {
          action_items?: Json | null
          analyzed_at?: string | null
          call_date?: string | null
          call_id: string
          call_type?: string | null
          client_id?: string | null
          close_attempted?: boolean | null
          compliance_flags?: Json | null
          contact_name?: string | null
          created_at?: string | null
          duration_seconds?: number | null
          id?: string
          next_step?: string | null
          objections_identified?: Json | null
          score_objection_handling?: number | null
          score_qualification?: number | null
          score_rapport?: number | null
          sentiment?: string | null
          summary?: string | null
          transcript?: string | null
        }
        Update: {
          action_items?: Json | null
          analyzed_at?: string | null
          call_date?: string | null
          call_id?: string
          call_type?: string | null
          client_id?: string | null
          close_attempted?: boolean | null
          compliance_flags?: Json | null
          contact_name?: string | null
          created_at?: string | null
          duration_seconds?: number | null
          id?: string
          next_step?: string | null
          objections_identified?: Json | null
          score_objection_handling?: number | null
          score_qualification?: number | null
          score_rapport?: number | null
          sentiment?: string | null
          summary?: string | null
          transcript?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_analysis_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "call_analysis_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_analysis_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      calls: {
        Row: {
          appointment_status: string | null
          booked_at: string | null
          call_connected: boolean | null
          call_duration_seconds: number | null
          client_id: string
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          direction: string | null
          external_id: string
          ghl_appointment_id: string | null
          ghl_calendar_id: string | null
          ghl_synced_at: string | null
          id: string
          is_reconnect: boolean | null
          lead_id: string | null
          outcome: string | null
          quality_score: number | null
          recording_url: string | null
          scheduled_at: string | null
          showed: boolean | null
          showed_at: string | null
          summary: string | null
          transcript: string | null
          updated_at: string
        }
        Insert: {
          appointment_status?: string | null
          booked_at?: string | null
          call_connected?: boolean | null
          call_duration_seconds?: number | null
          client_id: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          direction?: string | null
          external_id: string
          ghl_appointment_id?: string | null
          ghl_calendar_id?: string | null
          ghl_synced_at?: string | null
          id?: string
          is_reconnect?: boolean | null
          lead_id?: string | null
          outcome?: string | null
          quality_score?: number | null
          recording_url?: string | null
          scheduled_at?: string | null
          showed?: boolean | null
          showed_at?: string | null
          summary?: string | null
          transcript?: string | null
          updated_at?: string
        }
        Update: {
          appointment_status?: string | null
          booked_at?: string | null
          call_connected?: boolean | null
          call_duration_seconds?: number | null
          client_id?: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          direction?: string | null
          external_id?: string
          ghl_appointment_id?: string | null
          ghl_calendar_id?: string | null
          ghl_synced_at?: string | null
          id?: string
          is_reconnect?: boolean | null
          lead_id?: string | null
          outcome?: string | null
          quality_score?: number | null
          recording_url?: string | null
          scheduled_at?: string | null
          showed?: boolean | null
          showed_at?: string | null
          summary?: string | null
          transcript?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calls_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "calls_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "calls_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_conversations: {
        Row: {
          client_id: string | null
          conversation_type: string
          created_at: string
          id: string
          title: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          conversation_type?: string
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          conversation_type?: string
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_conversations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "chat_conversations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_conversations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_ad_assignments: {
        Row: {
          assigned_at: string | null
          assigned_by: string | null
          client_id: string | null
          creative_id: string | null
          id: string
          notes: string | null
        }
        Insert: {
          assigned_at?: string | null
          assigned_by?: string | null
          client_id?: string | null
          creative_id?: string | null
          id?: string
          notes?: string | null
        }
        Update: {
          assigned_at?: string | null
          assigned_by?: string | null
          client_id?: string | null
          creative_id?: string | null
          id?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_ad_assignments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_ad_assignments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_ad_assignments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_ad_assignments_creative_id_fkey"
            columns: ["creative_id"]
            isOneToOne: false
            referencedRelation: "creatives"
            referencedColumns: ["id"]
          },
        ]
      }
      client_agent_profiles: {
        Row: {
          brand_kit: Json | null
          client_id: string
          created_at: string
          notes: string | null
          profile_md: string | null
          updated_at: string
        }
        Insert: {
          brand_kit?: Json | null
          client_id: string
          created_at?: string
          notes?: string | null
          profile_md?: string | null
          updated_at?: string
        }
        Update: {
          brand_kit?: Json | null
          client_id?: string
          created_at?: string
          notes?: string | null
          profile_md?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_agent_profiles_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_agent_profiles_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_agent_profiles_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      client_agents: {
        Row: {
          agent_type: string
          client_id: string
          created_at: string
          enabled: boolean
          handle: string
          id: string
          knowledge_md: string | null
          model: string | null
          name: string
          reference_files: Json | null
          system_prompt: string | null
          updated_at: string
        }
        Insert: {
          agent_type?: string
          client_id: string
          created_at?: string
          enabled?: boolean
          handle: string
          id?: string
          knowledge_md?: string | null
          model?: string | null
          name: string
          reference_files?: Json | null
          system_prompt?: string | null
          updated_at?: string
        }
        Update: {
          agent_type?: string
          client_id?: string
          created_at?: string
          enabled?: boolean
          handle?: string
          id?: string
          knowledge_md?: string | null
          model?: string | null
          name?: string
          reference_files?: Json | null
          system_prompt?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_agents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_agents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_agents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      client_assets: {
        Row: {
          asset_type: string
          client_id: string
          content: Json | null
          created_at: string
          id: string
          offer_id: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          asset_type: string
          client_id: string
          content?: Json | null
          created_at?: string
          id?: string
          offer_id?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          asset_type?: string
          client_id?: string
          content?: Json | null
          created_at?: string
          id?: string
          offer_id?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_assets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_assets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_assets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_assets_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "client_offers"
            referencedColumns: ["id"]
          },
        ]
      }
      client_assignments: {
        Row: {
          account_manager: string | null
          client_id: string
          created_at: string
          media_buyer: string | null
          updated_at: string
        }
        Insert: {
          account_manager?: string | null
          client_id: string
          created_at?: string
          media_buyer?: string | null
          updated_at?: string
        }
        Update: {
          account_manager?: string | null
          client_id?: string
          created_at?: string
          media_buyer?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      client_brain: {
        Row: {
          brand_guidelines: string | null
          client_id: string
          created_at: string
          do_not_say: string | null
          icp: string | null
          learnings: Json
          updated_at: string
          voice: string | null
        }
        Insert: {
          brand_guidelines?: string | null
          client_id: string
          created_at?: string
          do_not_say?: string | null
          icp?: string | null
          learnings?: Json
          updated_at?: string
          voice?: string | null
        }
        Update: {
          brand_guidelines?: string | null
          client_id?: string
          created_at?: string
          do_not_say?: string | null
          icp?: string | null
          learnings?: Json
          updated_at?: string
          voice?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_brain_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_brain_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_brain_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      client_constraint_checklists: {
        Row: {
          checked: boolean
          checked_at: string | null
          checked_by: string | null
          checklist_type: string
          client_id: string
          created_at: string
          id: string
          item_key: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          checked?: boolean
          checked_at?: string | null
          checked_by?: string | null
          checklist_type: string
          client_id: string
          created_at?: string
          id?: string
          item_key: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          checked?: boolean
          checked_at?: string | null
          checked_by?: string | null
          checklist_type?: string
          client_id?: string
          created_at?: string
          id?: string
          item_key?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      client_custom_tabs: {
        Row: {
          client_id: string
          created_at: string
          id: string
          name: string
          sort_order: number
          updated_at: string
          url: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
          url: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_custom_tabs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_custom_tabs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_custom_tabs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      client_decisions: {
        Row: {
          client_id: string
          created_at: string
          decision: string | null
          file_url: string | null
          id: string
          notes: string | null
          owner_id: string | null
          owner_name: string | null
          status: string
          topic: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          decision?: string | null
          file_url?: string | null
          id?: string
          notes?: string | null
          owner_id?: string | null
          owner_name?: string | null
          status?: string
          topic: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          decision?: string | null
          file_url?: string | null
          id?: string
          notes?: string | null
          owner_id?: string | null
          owner_name?: string | null
          status?: string
          topic?: string
          updated_at?: string
        }
        Relationships: []
      }
      client_file_uploads: {
        Row: {
          client_id: string
          created_at: string
          file_name: string
          file_size_bytes: number | null
          file_type: string | null
          file_url: string
          folder_id: string | null
          id: string
          notes: string | null
          storage_path: string | null
          uploaded_by_name: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          file_name: string
          file_size_bytes?: number | null
          file_type?: string | null
          file_url: string
          folder_id?: string | null
          id?: string
          notes?: string | null
          storage_path?: string | null
          uploaded_by_name?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          file_name?: string
          file_size_bytes?: number | null
          file_type?: string | null
          file_url?: string
          folder_id?: string | null
          id?: string
          notes?: string | null
          storage_path?: string | null
          uploaded_by_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_file_uploads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_file_uploads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_file_uploads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_file_uploads_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "client_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      client_folders: {
        Row: {
          client_id: string
          color: string | null
          created_at: string
          id: string
          name: string
          parent_id: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          color?: string | null
          created_at?: string
          id?: string
          name: string
          parent_id?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          color?: string | null
          created_at?: string
          id?: string
          name?: string
          parent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "client_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      client_funnel_steps: {
        Row: {
          campaign_id: string | null
          client_id: string
          created_at: string | null
          id: string
          name: string
          sort_order: number | null
          step_type: string
          updated_at: string | null
          url: string
        }
        Insert: {
          campaign_id?: string | null
          client_id: string
          created_at?: string | null
          id?: string
          name: string
          sort_order?: number | null
          step_type?: string
          updated_at?: string | null
          url: string
        }
        Update: {
          campaign_id?: string | null
          client_id?: string
          created_at?: string | null
          id?: string
          name?: string
          sort_order?: number | null
          step_type?: string
          updated_at?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_funnel_steps_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "funnel_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_funnel_steps_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_funnel_steps_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_funnel_steps_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      client_live_ads: {
        Row: {
          ad_library_id: string | null
          ad_library_url: string | null
          ai_analysis: Json | null
          campaign_id: string | null
          client_id: string
          created_at: string | null
          cta_type: string | null
          description: string | null
          headline: string | null
          id: string
          impressions_bucket: string | null
          last_analyzed_at: string | null
          media_type: string | null
          media_urls: Json | null
          page_id: string | null
          page_name: string | null
          platforms: Json | null
          primary_text: string | null
          raw_markdown: string | null
          scraped_at: string | null
          started_running_on: string | null
          status: string | null
          thumbnail_url: string | null
          updated_at: string | null
        }
        Insert: {
          ad_library_id?: string | null
          ad_library_url?: string | null
          ai_analysis?: Json | null
          campaign_id?: string | null
          client_id: string
          created_at?: string | null
          cta_type?: string | null
          description?: string | null
          headline?: string | null
          id?: string
          impressions_bucket?: string | null
          last_analyzed_at?: string | null
          media_type?: string | null
          media_urls?: Json | null
          page_id?: string | null
          page_name?: string | null
          platforms?: Json | null
          primary_text?: string | null
          raw_markdown?: string | null
          scraped_at?: string | null
          started_running_on?: string | null
          status?: string | null
          thumbnail_url?: string | null
          updated_at?: string | null
        }
        Update: {
          ad_library_id?: string | null
          ad_library_url?: string | null
          ai_analysis?: Json | null
          campaign_id?: string | null
          client_id?: string
          created_at?: string | null
          cta_type?: string | null
          description?: string | null
          headline?: string | null
          id?: string
          impressions_bucket?: string | null
          last_analyzed_at?: string | null
          media_type?: string | null
          media_urls?: Json | null
          page_id?: string | null
          page_name?: string | null
          platforms?: Json | null
          primary_text?: string | null
          raw_markdown?: string | null
          scraped_at?: string | null
          started_running_on?: string | null
          status?: string | null
          thumbnail_url?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_live_ads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "funnel_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_live_ads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_live_ads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_live_ads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      client_offer_files: {
        Row: {
          client_id: string
          created_at: string
          file_name: string
          file_size_bytes: number | null
          file_type: string | null
          file_url: string
          id: string
          offer_id: string
          role: string | null
          sort_order: number | null
          tags: string[]
          uploaded_by: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          file_name: string
          file_size_bytes?: number | null
          file_type?: string | null
          file_url: string
          id?: string
          offer_id: string
          role?: string | null
          sort_order?: number | null
          tags?: string[]
          uploaded_by?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          file_name?: string
          file_size_bytes?: number | null
          file_type?: string | null
          file_url?: string
          id?: string
          offer_id?: string
          role?: string | null
          sort_order?: number | null
          tags?: string[]
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_offer_files_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_offer_files_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_offer_files_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_offer_files_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "client_offers"
            referencedColumns: ["id"]
          },
        ]
      }
      client_offer_training: {
        Row: {
          asset_url: string | null
          body: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          creative_type: string
          id: string
          offer_id: string
          source_canvas_item_id: string | null
          title: string
          updated_at: string
          weight: number
        }
        Insert: {
          asset_url?: string | null
          body?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          creative_type: string
          id?: string
          offer_id: string
          source_canvas_item_id?: string | null
          title: string
          updated_at?: string
          weight?: number
        }
        Update: {
          asset_url?: string | null
          body?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          creative_type?: string
          id?: string
          offer_id?: string
          source_canvas_item_id?: string | null
          title?: string
          updated_at?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "client_offer_training_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_offer_training_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_offer_training_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_offer_training_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "client_offers"
            referencedColumns: ["id"]
          },
        ]
      }
      client_offers: {
        Row: {
          accredited_only: boolean | null
          additional_notes: string | null
          brand_colors: Json | null
          brand_fonts: Json | null
          brand_notes: string | null
          budget_amount: number | null
          budget_mode: string | null
          client_id: string
          created_at: string
          credibility: string | null
          description: string | null
          distribution_schedule: string | null
          file_name: string | null
          file_size_bytes: number | null
          file_type: string | null
          file_url: string | null
          fund_history: string | null
          fund_name: string | null
          fund_type: string | null
          ghl_location_id: string | null
          hold_period: string | null
          id: string
          industry_focus: string | null
          investment_range: string | null
          logo_url: string | null
          meta_ad_account_id: string | null
          meta_page_id: string | null
          meta_pixel_id: string | null
          min_investment: string | null
          offer_type: string
          pitch_deck_url: string | null
          raise_amount: string | null
          raw_form_data: Json | null
          reg_d_type: string | null
          speaker_name: string | null
          status: string | null
          target_investor: string | null
          targeted_returns: string | null
          tax_advantages: string | null
          timeline: string | null
          title: string
          updated_at: string
          uploaded_by: string | null
          website_url: string | null
        }
        Insert: {
          accredited_only?: boolean | null
          additional_notes?: string | null
          brand_colors?: Json | null
          brand_fonts?: Json | null
          brand_notes?: string | null
          budget_amount?: number | null
          budget_mode?: string | null
          client_id: string
          created_at?: string
          credibility?: string | null
          description?: string | null
          distribution_schedule?: string | null
          file_name?: string | null
          file_size_bytes?: number | null
          file_type?: string | null
          file_url?: string | null
          fund_history?: string | null
          fund_name?: string | null
          fund_type?: string | null
          ghl_location_id?: string | null
          hold_period?: string | null
          id?: string
          industry_focus?: string | null
          investment_range?: string | null
          logo_url?: string | null
          meta_ad_account_id?: string | null
          meta_page_id?: string | null
          meta_pixel_id?: string | null
          min_investment?: string | null
          offer_type?: string
          pitch_deck_url?: string | null
          raise_amount?: string | null
          raw_form_data?: Json | null
          reg_d_type?: string | null
          speaker_name?: string | null
          status?: string | null
          target_investor?: string | null
          targeted_returns?: string | null
          tax_advantages?: string | null
          timeline?: string | null
          title: string
          updated_at?: string
          uploaded_by?: string | null
          website_url?: string | null
        }
        Update: {
          accredited_only?: boolean | null
          additional_notes?: string | null
          brand_colors?: Json | null
          brand_fonts?: Json | null
          brand_notes?: string | null
          budget_amount?: number | null
          budget_mode?: string | null
          client_id?: string
          created_at?: string
          credibility?: string | null
          description?: string | null
          distribution_schedule?: string | null
          file_name?: string | null
          file_size_bytes?: number | null
          file_type?: string | null
          file_url?: string | null
          fund_history?: string | null
          fund_name?: string | null
          fund_type?: string | null
          ghl_location_id?: string | null
          hold_period?: string | null
          id?: string
          industry_focus?: string | null
          investment_range?: string | null
          logo_url?: string | null
          meta_ad_account_id?: string | null
          meta_page_id?: string | null
          meta_pixel_id?: string | null
          min_investment?: string | null
          offer_type?: string
          pitch_deck_url?: string | null
          raise_amount?: string | null
          raw_form_data?: Json | null
          reg_d_type?: string | null
          speaker_name?: string | null
          status?: string | null
          target_investor?: string | null
          targeted_returns?: string | null
          tax_advantages?: string | null
          timeline?: string | null
          title?: string
          updated_at?: string
          uploaded_by?: string | null
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_offers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_offers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_offers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      client_onboarding_tasks: {
        Row: {
          category: string
          client_id: string
          completed: boolean
          completed_at: string | null
          created_at: string
          id: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          category: string
          client_id: string
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          id?: string
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          category?: string
          client_id?: string
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          id?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_onboarding_tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_onboarding_tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_onboarding_tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      client_pipelines: {
        Row: {
          client_id: string
          created_at: string
          ghl_pipeline_id: string
          id: string
          last_synced_at: string | null
          name: string
          sort_order: number
        }
        Insert: {
          client_id: string
          created_at?: string
          ghl_pipeline_id: string
          id?: string
          last_synced_at?: string | null
          name: string
          sort_order?: number
        }
        Update: {
          client_id?: string
          created_at?: string
          ghl_pipeline_id?: string
          id?: string
          last_synced_at?: string | null
          name?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "client_pipelines_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_pipelines_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_pipelines_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      client_pod_assignments: {
        Row: {
          client_id: string
          created_at: string
          id: string
          is_lead: boolean | null
          pod_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          is_lead?: boolean | null
          pod_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          is_lead?: boolean | null
          pod_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_pod_assignments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_pod_assignments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_pod_assignments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_pod_assignments_pod_id_fkey"
            columns: ["pod_id"]
            isOneToOne: false
            referencedRelation: "agency_pods"
            referencedColumns: ["id"]
          },
        ]
      }
      client_references: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          mime: string | null
          name: string
          notes: string | null
          tags: string[] | null
          updated_at: string
          url: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          mime?: string | null
          name: string
          notes?: string | null
          tags?: string[] | null
          updated_at?: string
          url: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          mime?: string | null
          name?: string
          notes?: string | null
          tags?: string[] | null
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_references_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_references_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_references_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      client_report_recipients: {
        Row: {
          active: boolean
          cadences: string[]
          channels: string[]
          client_id: string
          created_at: string
          email: string | null
          id: string
          name: string
          phone_e164: string | null
          role: string | null
          unsubscribe_token: string
          unsubscribed_at: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          cadences?: string[]
          channels?: string[]
          client_id: string
          created_at?: string
          email?: string | null
          id?: string
          name: string
          phone_e164?: string | null
          role?: string | null
          unsubscribe_token?: string
          unsubscribed_at?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          cadences?: string[]
          channels?: string[]
          client_id?: string
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          phone_e164?: string | null
          role?: string | null
          unsubscribe_token?: string
          unsubscribed_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_report_recipients_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_report_recipients_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_report_recipients_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      client_report_sends: {
        Row: {
          cadence: string
          channel: string
          client_id: string
          created_at: string
          error: string | null
          ghl_contact_id: string | null
          ghl_message_id: string | null
          id: string
          idempotency_key: string
          payload: Json | null
          period_end: string
          period_start: string
          recipient_id: string | null
          sent_at: string | null
          status: string
        }
        Insert: {
          cadence: string
          channel: string
          client_id: string
          created_at?: string
          error?: string | null
          ghl_contact_id?: string | null
          ghl_message_id?: string | null
          id?: string
          idempotency_key: string
          payload?: Json | null
          period_end: string
          period_start: string
          recipient_id?: string | null
          sent_at?: string | null
          status?: string
        }
        Update: {
          cadence?: string
          channel?: string
          client_id?: string
          created_at?: string
          error?: string | null
          ghl_contact_id?: string | null
          ghl_message_id?: string | null
          id?: string
          idempotency_key?: string
          payload?: Json | null
          period_end?: string
          period_start?: string
          recipient_id?: string | null
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_report_sends_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_report_sends_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_report_sends_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_report_sends_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "client_report_recipients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_settings: {
        Row: {
          ad_spend_fee_percent: number | null
          ad_spend_fee_threshold: number | null
          ads_library_page_id: string | null
          ads_library_url: string | null
          canva_url: string | null
          client_id: string
          committed_stage_ids: string[] | null
          cost_of_capital_threshold_red: number | null
          cost_of_capital_threshold_yellow: number | null
          cost_per_call_threshold_red: number | null
          cost_per_call_threshold_yellow: number | null
          cost_per_investor_threshold_red: number | null
          cost_per_investor_threshold_yellow: number | null
          cost_per_show_threshold_red: number | null
          cost_per_show_threshold_yellow: number | null
          cpl_threshold_red: number | null
          cpl_threshold_yellow: number | null
          created_at: string
          daily_ad_spend_target: number | null
          default_lead_pipeline_value: number | null
          email_auto_approve_threshold: number | null
          email_default_offering: string | null
          email_parsing_enabled: boolean | null
          email_trusted_domains: string[] | null
          fathom_api_key: string | null
          fathom_api_keys: Json | null
          fathom_enabled: boolean | null
          fathom_last_sync: string | null
          funded_investor_label: string | null
          funded_pipeline_id: string | null
          funded_stage_ids: string[] | null
          funded_tag_pattern: string | null
          ghl_custom_field_map: Json | null
          ghl_last_calls_sync: string | null
          ghl_last_contacts_sync: string | null
          ghl_sync_calls_enabled: boolean | null
          ghl_sync_contacts_enabled: boolean | null
          ghl_sync_conversations_enabled: boolean | null
          hubspot_booked_meeting_types: string[] | null
          hubspot_committed_stage_ids: string[] | null
          hubspot_funded_pipeline_id: string | null
          hubspot_funded_stage_ids: string[] | null
          hubspot_last_contacts_sync: string | null
          hubspot_last_deals_sync: string | null
          hubspot_reconnect_meeting_types: string[] | null
          hubspot_sync_enabled: boolean | null
          id: string
          kpi_google_doc_url: string | null
          kpi_google_sheet_url: string | null
          meetgeek_api_key: string | null
          meetgeek_enabled: boolean | null
          meetgeek_last_sync: string | null
          meetgeek_region: string | null
          meetgeek_webhook_secret: string | null
          meta_ads_last_sync: string | null
          meta_ads_last_sync_date: string | null
          meta_ads_sync_enabled: boolean | null
          meta_ads_sync_streak: number
          metric_labels: Json | null
          metrics_sheet_gid: string | null
          metrics_sheet_id: string | null
          metrics_sheet_mapping: Json | null
          metrics_sheet_range: string | null
          metrics_source_default: string | null
          monthly_ad_spend_target: number | null
          mrr: number | null
          pixel_notification_email: string | null
          pixel_verification_enabled: boolean | null
          pixel_verification_frequency: string | null
          public_link_password: string | null
          reconnect_calendar_ids: string[] | null
          retargetiq_auto_enrich: boolean | null
          retargetiq_website_slug: string | null
          slack_channel_id: string | null
          slack_review_channel_id: string | null
          stripe_customer_id: string | null
          stripe_email: string | null
          total_raise_amount: number | null
          tracked_calendar_ids: string[] | null
          updated_at: string
          webhook_mappings: Json | null
          weekly_sync_day: number | null
          weekly_sync_time: string | null
          weekly_sync_timezone: string | null
        }
        Insert: {
          ad_spend_fee_percent?: number | null
          ad_spend_fee_threshold?: number | null
          ads_library_page_id?: string | null
          ads_library_url?: string | null
          canva_url?: string | null
          client_id: string
          committed_stage_ids?: string[] | null
          cost_of_capital_threshold_red?: number | null
          cost_of_capital_threshold_yellow?: number | null
          cost_per_call_threshold_red?: number | null
          cost_per_call_threshold_yellow?: number | null
          cost_per_investor_threshold_red?: number | null
          cost_per_investor_threshold_yellow?: number | null
          cost_per_show_threshold_red?: number | null
          cost_per_show_threshold_yellow?: number | null
          cpl_threshold_red?: number | null
          cpl_threshold_yellow?: number | null
          created_at?: string
          daily_ad_spend_target?: number | null
          default_lead_pipeline_value?: number | null
          email_auto_approve_threshold?: number | null
          email_default_offering?: string | null
          email_parsing_enabled?: boolean | null
          email_trusted_domains?: string[] | null
          fathom_api_key?: string | null
          fathom_api_keys?: Json | null
          fathom_enabled?: boolean | null
          fathom_last_sync?: string | null
          funded_investor_label?: string | null
          funded_pipeline_id?: string | null
          funded_stage_ids?: string[] | null
          funded_tag_pattern?: string | null
          ghl_custom_field_map?: Json | null
          ghl_last_calls_sync?: string | null
          ghl_last_contacts_sync?: string | null
          ghl_sync_calls_enabled?: boolean | null
          ghl_sync_contacts_enabled?: boolean | null
          ghl_sync_conversations_enabled?: boolean | null
          hubspot_booked_meeting_types?: string[] | null
          hubspot_committed_stage_ids?: string[] | null
          hubspot_funded_pipeline_id?: string | null
          hubspot_funded_stage_ids?: string[] | null
          hubspot_last_contacts_sync?: string | null
          hubspot_last_deals_sync?: string | null
          hubspot_reconnect_meeting_types?: string[] | null
          hubspot_sync_enabled?: boolean | null
          id?: string
          kpi_google_doc_url?: string | null
          kpi_google_sheet_url?: string | null
          meetgeek_api_key?: string | null
          meetgeek_enabled?: boolean | null
          meetgeek_last_sync?: string | null
          meetgeek_region?: string | null
          meetgeek_webhook_secret?: string | null
          meta_ads_last_sync?: string | null
          meta_ads_last_sync_date?: string | null
          meta_ads_sync_enabled?: boolean | null
          meta_ads_sync_streak?: number
          metric_labels?: Json | null
          metrics_sheet_gid?: string | null
          metrics_sheet_id?: string | null
          metrics_sheet_mapping?: Json | null
          metrics_sheet_range?: string | null
          metrics_source_default?: string | null
          monthly_ad_spend_target?: number | null
          mrr?: number | null
          pixel_notification_email?: string | null
          pixel_verification_enabled?: boolean | null
          pixel_verification_frequency?: string | null
          public_link_password?: string | null
          reconnect_calendar_ids?: string[] | null
          retargetiq_auto_enrich?: boolean | null
          retargetiq_website_slug?: string | null
          slack_channel_id?: string | null
          slack_review_channel_id?: string | null
          stripe_customer_id?: string | null
          stripe_email?: string | null
          total_raise_amount?: number | null
          tracked_calendar_ids?: string[] | null
          updated_at?: string
          webhook_mappings?: Json | null
          weekly_sync_day?: number | null
          weekly_sync_time?: string | null
          weekly_sync_timezone?: string | null
        }
        Update: {
          ad_spend_fee_percent?: number | null
          ad_spend_fee_threshold?: number | null
          ads_library_page_id?: string | null
          ads_library_url?: string | null
          canva_url?: string | null
          client_id?: string
          committed_stage_ids?: string[] | null
          cost_of_capital_threshold_red?: number | null
          cost_of_capital_threshold_yellow?: number | null
          cost_per_call_threshold_red?: number | null
          cost_per_call_threshold_yellow?: number | null
          cost_per_investor_threshold_red?: number | null
          cost_per_investor_threshold_yellow?: number | null
          cost_per_show_threshold_red?: number | null
          cost_per_show_threshold_yellow?: number | null
          cpl_threshold_red?: number | null
          cpl_threshold_yellow?: number | null
          created_at?: string
          daily_ad_spend_target?: number | null
          default_lead_pipeline_value?: number | null
          email_auto_approve_threshold?: number | null
          email_default_offering?: string | null
          email_parsing_enabled?: boolean | null
          email_trusted_domains?: string[] | null
          fathom_api_key?: string | null
          fathom_api_keys?: Json | null
          fathom_enabled?: boolean | null
          fathom_last_sync?: string | null
          funded_investor_label?: string | null
          funded_pipeline_id?: string | null
          funded_stage_ids?: string[] | null
          funded_tag_pattern?: string | null
          ghl_custom_field_map?: Json | null
          ghl_last_calls_sync?: string | null
          ghl_last_contacts_sync?: string | null
          ghl_sync_calls_enabled?: boolean | null
          ghl_sync_contacts_enabled?: boolean | null
          ghl_sync_conversations_enabled?: boolean | null
          hubspot_booked_meeting_types?: string[] | null
          hubspot_committed_stage_ids?: string[] | null
          hubspot_funded_pipeline_id?: string | null
          hubspot_funded_stage_ids?: string[] | null
          hubspot_last_contacts_sync?: string | null
          hubspot_last_deals_sync?: string | null
          hubspot_reconnect_meeting_types?: string[] | null
          hubspot_sync_enabled?: boolean | null
          id?: string
          kpi_google_doc_url?: string | null
          kpi_google_sheet_url?: string | null
          meetgeek_api_key?: string | null
          meetgeek_enabled?: boolean | null
          meetgeek_last_sync?: string | null
          meetgeek_region?: string | null
          meetgeek_webhook_secret?: string | null
          meta_ads_last_sync?: string | null
          meta_ads_last_sync_date?: string | null
          meta_ads_sync_enabled?: boolean | null
          meta_ads_sync_streak?: number
          metric_labels?: Json | null
          metrics_sheet_gid?: string | null
          metrics_sheet_id?: string | null
          metrics_sheet_mapping?: Json | null
          metrics_sheet_range?: string | null
          metrics_source_default?: string | null
          monthly_ad_spend_target?: number | null
          mrr?: number | null
          pixel_notification_email?: string | null
          pixel_verification_enabled?: boolean | null
          pixel_verification_frequency?: string | null
          public_link_password?: string | null
          reconnect_calendar_ids?: string[] | null
          retargetiq_auto_enrich?: boolean | null
          retargetiq_website_slug?: string | null
          slack_channel_id?: string | null
          slack_review_channel_id?: string | null
          stripe_customer_id?: string | null
          stripe_email?: string | null
          total_raise_amount?: number | null
          tracked_calendar_ids?: string[] | null
          updated_at?: string
          webhook_mappings?: Json | null
          weekly_sync_day?: number | null
          weekly_sync_time?: string | null
          weekly_sync_timezone?: string | null
        }
        Relationships: []
      }
      client_team_members: {
        Row: {
          client_id: string
          created_at: string
          email: string | null
          id: string
          is_primary_contact: boolean
          name: string
          notes: string | null
          phone: string | null
          role: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          email?: string | null
          id?: string
          is_primary_contact?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          role?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          email?: string | null
          id?: string
          is_primary_contact?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          role?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_team_members_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_team_members_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_team_members_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      client_videos: {
        Row: {
          aspect_ratio: string | null
          canvas_item_id: string | null
          client_id: string
          conversation_id: string | null
          created_at: string
          created_by: string | null
          duration_seconds: number | null
          edit_instructions: string | null
          id: string
          metadata: Json
          model: string | null
          parent_video_id: string | null
          poster_url: string | null
          prompt: string | null
          resolution: string | null
          source: string
          source_url: string | null
          status: string
          storage_path: string | null
          storage_url: string
          title: string | null
          updated_at: string
        }
        Insert: {
          aspect_ratio?: string | null
          canvas_item_id?: string | null
          client_id: string
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          duration_seconds?: number | null
          edit_instructions?: string | null
          id?: string
          metadata?: Json
          model?: string | null
          parent_video_id?: string | null
          poster_url?: string | null
          prompt?: string | null
          resolution?: string | null
          source?: string
          source_url?: string | null
          status?: string
          storage_path?: string | null
          storage_url: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          aspect_ratio?: string | null
          canvas_item_id?: string | null
          client_id?: string
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          duration_seconds?: number | null
          edit_instructions?: string | null
          id?: string
          metadata?: Json
          model?: string | null
          parent_video_id?: string | null
          poster_url?: string | null
          prompt?: string | null
          resolution?: string | null
          source?: string
          source_url?: string | null
          status?: string
          storage_path?: string | null
          storage_url?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_videos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_videos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_videos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_videos_parent_video_id_fkey"
            columns: ["parent_video_id"]
            isOneToOne: false
            referencedRelation: "client_videos"
            referencedColumns: ["id"]
          },
        ]
      }
      client_voice_notes: {
        Row: {
          action_items: Json | null
          audio_url: string | null
          client_id: string
          created_at: string
          duration_seconds: number | null
          id: string
          is_public_recording: boolean | null
          recorded_by: string | null
          summary: string | null
          title: string
          transcript: string | null
        }
        Insert: {
          action_items?: Json | null
          audio_url?: string | null
          client_id: string
          created_at?: string
          duration_seconds?: number | null
          id?: string
          is_public_recording?: boolean | null
          recorded_by?: string | null
          summary?: string | null
          title: string
          transcript?: string | null
        }
        Update: {
          action_items?: Json | null
          audio_url?: string | null
          client_id?: string
          created_at?: string
          duration_seconds?: number | null
          id?: string
          is_public_recording?: boolean | null
          recorded_by?: string | null
          summary?: string | null
          title?: string
          transcript?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_voice_notes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_voice_notes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_voice_notes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      clients: {
        Row: {
          account_manager: string | null
          automation_checklist: Json
          brand_colors: Json | null
          brand_fonts: Json | null
          business_manager_url: string | null
          consecutive_ghl_failures: number
          consecutive_meta_failures: number
          created_at: string
          description: string | null
          ghl_account_url: string | null
          ghl_api_key: string | null
          ghl_firebase_refresh_token: string | null
          ghl_location_id: string | null
          ghl_sync_error: string | null
          ghl_sync_status: string | null
          google_doc_id: string | null
          google_doc_url: string | null
          hubspot_access_token: string | null
          hubspot_portal_id: string | null
          hubspot_sync_error: string | null
          hubspot_sync_status: string | null
          id: string
          industry: string | null
          intake_company_name: string | null
          last_ghl_sync_at: string | null
          last_hubspot_sync_at: string | null
          last_timeline_sync_at: string | null
          logo_url: string | null
          media_buyer: string | null
          meta_access_token: string | null
          meta_ad_account_id: string | null
          meta_ad_account_ids: string[] | null
          name: string
          notification_email: string | null
          notification_phone: string | null
          offer_description: string | null
          product_images: Json | null
          product_url: string | null
          public_token: string | null
          slug: string | null
          sort_order: number | null
          status: string
          updated_at: string
          webhook_secret: string | null
          website_url: string | null
          whatsapp_notify_numbers: string[]
        }
        Insert: {
          account_manager?: string | null
          automation_checklist?: Json
          brand_colors?: Json | null
          brand_fonts?: Json | null
          business_manager_url?: string | null
          consecutive_ghl_failures?: number
          consecutive_meta_failures?: number
          created_at?: string
          description?: string | null
          ghl_account_url?: string | null
          ghl_api_key?: string | null
          ghl_firebase_refresh_token?: string | null
          ghl_location_id?: string | null
          ghl_sync_error?: string | null
          ghl_sync_status?: string | null
          google_doc_id?: string | null
          google_doc_url?: string | null
          hubspot_access_token?: string | null
          hubspot_portal_id?: string | null
          hubspot_sync_error?: string | null
          hubspot_sync_status?: string | null
          id?: string
          industry?: string | null
          intake_company_name?: string | null
          last_ghl_sync_at?: string | null
          last_hubspot_sync_at?: string | null
          last_timeline_sync_at?: string | null
          logo_url?: string | null
          media_buyer?: string | null
          meta_access_token?: string | null
          meta_ad_account_id?: string | null
          meta_ad_account_ids?: string[] | null
          name: string
          notification_email?: string | null
          notification_phone?: string | null
          offer_description?: string | null
          product_images?: Json | null
          product_url?: string | null
          public_token?: string | null
          slug?: string | null
          sort_order?: number | null
          status?: string
          updated_at?: string
          webhook_secret?: string | null
          website_url?: string | null
          whatsapp_notify_numbers?: string[]
        }
        Update: {
          account_manager?: string | null
          automation_checklist?: Json
          brand_colors?: Json | null
          brand_fonts?: Json | null
          business_manager_url?: string | null
          consecutive_ghl_failures?: number
          consecutive_meta_failures?: number
          created_at?: string
          description?: string | null
          ghl_account_url?: string | null
          ghl_api_key?: string | null
          ghl_firebase_refresh_token?: string | null
          ghl_location_id?: string | null
          ghl_sync_error?: string | null
          ghl_sync_status?: string | null
          google_doc_id?: string | null
          google_doc_url?: string | null
          hubspot_access_token?: string | null
          hubspot_portal_id?: string | null
          hubspot_sync_error?: string | null
          hubspot_sync_status?: string | null
          id?: string
          industry?: string | null
          intake_company_name?: string | null
          last_ghl_sync_at?: string | null
          last_hubspot_sync_at?: string | null
          last_timeline_sync_at?: string | null
          logo_url?: string | null
          media_buyer?: string | null
          meta_access_token?: string | null
          meta_ad_account_id?: string | null
          meta_ad_account_ids?: string[] | null
          name?: string
          notification_email?: string | null
          notification_phone?: string | null
          offer_description?: string | null
          product_images?: Json | null
          product_url?: string | null
          public_token?: string | null
          slug?: string | null
          sort_order?: number | null
          status?: string
          updated_at?: string
          webhook_secret?: string | null
          website_url?: string | null
          whatsapp_notify_numbers?: string[]
        }
        Relationships: []
      }
      contact_timeline_events: {
        Row: {
          body: string | null
          client_id: string
          created_at: string
          event_at: string
          event_subtype: string | null
          event_type: string
          ghl_contact_id: string
          id: string
          lead_id: string | null
          metadata: Json | null
          title: string | null
        }
        Insert: {
          body?: string | null
          client_id: string
          created_at?: string
          event_at: string
          event_subtype?: string | null
          event_type: string
          ghl_contact_id: string
          id?: string
          lead_id?: string | null
          metadata?: Json | null
          title?: string | null
        }
        Update: {
          body?: string | null
          client_id?: string
          created_at?: string
          event_at?: string
          event_subtype?: string | null
          event_type?: string
          ghl_contact_id?: string
          id?: string
          lead_id?: string | null
          metadata?: Json | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_timeline_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "contact_timeline_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_timeline_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "contact_timeline_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      content_queue: {
        Row: {
          angle: string | null
          approved_at: string | null
          approved_by: string | null
          client_id: string | null
          compliance_flags: Json | null
          compliance_score: number | null
          content_type: string
          created_at: string | null
          draft: string
          final_version: string | null
          id: string
          metadata: Json | null
          performance_data: Json | null
          published_at: string | null
          rejected_reason: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          angle?: string | null
          approved_at?: string | null
          approved_by?: string | null
          client_id?: string | null
          compliance_flags?: Json | null
          compliance_score?: number | null
          content_type: string
          created_at?: string | null
          draft: string
          final_version?: string | null
          id?: string
          metadata?: Json | null
          performance_data?: Json | null
          published_at?: string | null
          rejected_reason?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          angle?: string | null
          approved_at?: string | null
          approved_by?: string | null
          client_id?: string | null
          compliance_flags?: Json | null
          compliance_score?: number | null
          content_type?: string
          created_at?: string | null
          draft?: string
          final_version?: string | null
          id?: string
          metadata?: Json | null
          performance_data?: Json | null
          published_at?: string | null
          rejected_reason?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_queue_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "content_queue_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_queue_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      copy_library: {
        Row: {
          client_id: string | null
          content: string
          created_at: string | null
          id: string
          is_favorite: boolean | null
          performance_score: number | null
          platform: string | null
          tags: string[] | null
          type: string
        }
        Insert: {
          client_id?: string | null
          content: string
          created_at?: string | null
          id?: string
          is_favorite?: boolean | null
          performance_score?: number | null
          platform?: string | null
          tags?: string[] | null
          type?: string
        }
        Update: {
          client_id?: string | null
          content?: string
          created_at?: string | null
          id?: string
          is_favorite?: boolean | null
          performance_score?: number | null
          platform?: string | null
          tags?: string[] | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "copy_library_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "copy_library_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copy_library_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      creative_briefs: {
        Row: {
          ad_format: string | null
          approved_at: string | null
          approved_by: string | null
          client_id: string
          client_name: string
          created_at: string
          creative_direction: string | null
          full_brief_json: Json | null
          generated_by: string | null
          generation_reason: string | null
          hook_patterns: string[] | null
          id: string
          messaging_angles: Json | null
          notes: string | null
          objective: string | null
          offer_angles: string[] | null
          performance_snapshot: Json | null
          platform: string | null
          recommended_variations: Json | null
          rejection_reason: string | null
          source: string
          source_campaigns: Json | null
          status: string
          target_audience: Json | null
          title: string | null
          updated_at: string
          winning_ad_summary: Json | null
        }
        Insert: {
          ad_format?: string | null
          approved_at?: string | null
          approved_by?: string | null
          client_id: string
          client_name: string
          created_at?: string
          creative_direction?: string | null
          full_brief_json?: Json | null
          generated_by?: string | null
          generation_reason?: string | null
          hook_patterns?: string[] | null
          id?: string
          messaging_angles?: Json | null
          notes?: string | null
          objective?: string | null
          offer_angles?: string[] | null
          performance_snapshot?: Json | null
          platform?: string | null
          recommended_variations?: Json | null
          rejection_reason?: string | null
          source?: string
          source_campaigns?: Json | null
          status?: string
          target_audience?: Json | null
          title?: string | null
          updated_at?: string
          winning_ad_summary?: Json | null
        }
        Update: {
          ad_format?: string | null
          approved_at?: string | null
          approved_by?: string | null
          client_id?: string
          client_name?: string
          created_at?: string
          creative_direction?: string | null
          full_brief_json?: Json | null
          generated_by?: string | null
          generation_reason?: string | null
          hook_patterns?: string[] | null
          id?: string
          messaging_angles?: Json | null
          notes?: string | null
          objective?: string | null
          offer_angles?: string[] | null
          performance_snapshot?: Json | null
          platform?: string | null
          recommended_variations?: Json | null
          rejection_reason?: string | null
          source?: string
          source_campaigns?: Json | null
          status?: string
          target_audience?: Json | null
          title?: string | null
          updated_at?: string
          winning_ad_summary?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "creative_briefs_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "agency_members"
            referencedColumns: ["id"]
          },
        ]
      }
      creatives: {
        Row: {
          ai_performance_score: number | null
          ai_variations: Json
          aspect_ratio: string | null
          body_copy: string | null
          canva_design_id: string | null
          canva_url: string | null
          client_id: string
          comments: Json | null
          created_at: string
          cta_text: string | null
          file_url: string | null
          headline: string | null
          id: string
          platform: string | null
          source: string
          source_type: string
          status: string
          title: string
          trigger_campaign_id: string | null
          type: string
          updated_at: string
          version_history: Json | null
        }
        Insert: {
          ai_performance_score?: number | null
          ai_variations?: Json
          aspect_ratio?: string | null
          body_copy?: string | null
          canva_design_id?: string | null
          canva_url?: string | null
          client_id: string
          comments?: Json | null
          created_at?: string
          cta_text?: string | null
          file_url?: string | null
          headline?: string | null
          id?: string
          platform?: string | null
          source?: string
          source_type?: string
          status?: string
          title: string
          trigger_campaign_id?: string | null
          type?: string
          updated_at?: string
          version_history?: Json | null
        }
        Update: {
          ai_performance_score?: number | null
          ai_variations?: Json
          aspect_ratio?: string | null
          body_copy?: string | null
          canva_design_id?: string | null
          canva_url?: string | null
          client_id?: string
          comments?: Json | null
          created_at?: string
          cta_text?: string | null
          file_url?: string | null
          headline?: string | null
          id?: string
          platform?: string | null
          source?: string
          source_type?: string
          status?: string
          title?: string
          trigger_campaign_id?: string | null
          type?: string
          updated_at?: string
          version_history?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "creatives_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "creatives_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creatives_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      cron_run_log: {
        Row: {
          duration_ms: number | null
          error_message: string | null
          id: string
          job_name: string
          ran_at: string
          response_body: string | null
          status: string
          status_code: number | null
        }
        Insert: {
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          job_name: string
          ran_at?: string
          response_body?: string | null
          status?: string
          status_code?: number | null
        }
        Update: {
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          job_name?: string
          ran_at?: string
          response_body?: string | null
          status?: string
          status_code?: number | null
        }
        Relationships: []
      }
      csv_import_logs: {
        Row: {
          client_id: string
          created_at: string
          failed_count: number
          file_name: string | null
          id: string
          import_type: string
          records_count: number
          success_count: number
        }
        Insert: {
          client_id: string
          created_at?: string
          failed_count?: number
          file_name?: string | null
          id?: string
          import_type: string
          records_count?: number
          success_count?: number
        }
        Update: {
          client_id?: string
          created_at?: string
          failed_count?: number
          file_name?: string | null
          id?: string
          import_type?: string
          records_count?: number
          success_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "csv_import_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "csv_import_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "csv_import_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      custom_ads: {
        Row: {
          body: string | null
          category: string | null
          client_id: string | null
          created_at: string | null
          cta: string | null
          description: string | null
          file_type: string | null
          file_url: string | null
          headline: string | null
          id: string
          image_url: string | null
          name: string
          platform: string | null
          tags: string[] | null
          type: string
          video_url: string | null
        }
        Insert: {
          body?: string | null
          category?: string | null
          client_id?: string | null
          created_at?: string | null
          cta?: string | null
          description?: string | null
          file_type?: string | null
          file_url?: string | null
          headline?: string | null
          id?: string
          image_url?: string | null
          name: string
          platform?: string | null
          tags?: string[] | null
          type?: string
          video_url?: string | null
        }
        Update: {
          body?: string | null
          category?: string | null
          client_id?: string | null
          created_at?: string | null
          cta?: string | null
          description?: string | null
          file_type?: string | null
          file_url?: string | null
          headline?: string | null
          id?: string
          image_url?: string | null
          name?: string
          platform?: string | null
          tags?: string[] | null
          type?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "custom_ads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "custom_ads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_ads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      custom_gpts: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          icon: string | null
          id: string
          is_active: boolean | null
          name: string
          system_prompt: string
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          system_prompt: string
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          system_prompt?: string
          updated_at?: string
        }
        Relationships: []
      }
      daily_ai_summaries: {
        Row: {
          ai_summary: string | null
          client_stats: Json
          created_at: string
          delivered_email: boolean
          delivered_slack: boolean
          id: string
          sheet_alerts: Json
          summary_date: string
          tasks_due_today: Json
          updated_at: string
        }
        Insert: {
          ai_summary?: string | null
          client_stats?: Json
          created_at?: string
          delivered_email?: boolean
          delivered_slack?: boolean
          id?: string
          sheet_alerts?: Json
          summary_date: string
          tasks_due_today?: Json
          updated_at?: string
        }
        Update: {
          ai_summary?: string | null
          client_stats?: Json
          created_at?: string
          delivered_email?: boolean
          delivered_slack?: boolean
          id?: string
          sheet_alerts?: Json
          summary_date?: string
          tasks_due_today?: Json
          updated_at?: string
        }
        Relationships: []
      }
      daily_metrics: {
        Row: {
          ad_spend: number | null
          calls: number | null
          calls_scheduled: number | null
          calls_showed: number | null
          clicks: number | null
          client_id: string
          commitment_dollars: number | null
          commitments: number | null
          commitments_on_day: number | null
          created_at: string
          ctr: number | null
          date: string
          date_account_tz: string | null
          funded_dollars: number | null
          funded_investors: number | null
          funded_on_day: number | null
          id: string
          impressions: number | null
          leads: number | null
          leads_created: number | null
          reconnect_calls: number | null
          reconnect_showed: number | null
          showed_calls: number | null
          spam_leads: number | null
          unattributed_leads: number | null
          updated_at: string
        }
        Insert: {
          ad_spend?: number | null
          calls?: number | null
          calls_scheduled?: number | null
          calls_showed?: number | null
          clicks?: number | null
          client_id: string
          commitment_dollars?: number | null
          commitments?: number | null
          commitments_on_day?: number | null
          created_at?: string
          ctr?: number | null
          date: string
          date_account_tz?: string | null
          funded_dollars?: number | null
          funded_investors?: number | null
          funded_on_day?: number | null
          id?: string
          impressions?: number | null
          leads?: number | null
          leads_created?: number | null
          reconnect_calls?: number | null
          reconnect_showed?: number | null
          showed_calls?: number | null
          spam_leads?: number | null
          unattributed_leads?: number | null
          updated_at?: string
        }
        Update: {
          ad_spend?: number | null
          calls?: number | null
          calls_scheduled?: number | null
          calls_showed?: number | null
          clicks?: number | null
          client_id?: string
          commitment_dollars?: number | null
          commitments?: number | null
          commitments_on_day?: number | null
          created_at?: string
          ctr?: number | null
          date?: string
          date_account_tz?: string | null
          funded_dollars?: number | null
          funded_investors?: number | null
          funded_on_day?: number | null
          id?: string
          impressions?: number | null
          leads?: number | null
          leads_created?: number | null
          reconnect_calls?: number | null
          reconnect_showed?: number | null
          showed_calls?: number | null
          spam_leads?: number | null
          unattributed_leads?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_metrics_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "daily_metrics_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_metrics_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      daily_reports: {
        Row: {
          client_experience_done: boolean | null
          created_at: string
          id: string
          member_id: string
          report_date: string
          report_type: string
          self_assessment: number | null
          tasks_snapshot: Json | null
          top_priorities: Json | null
          touchpoint_count: number | null
          touchpoint_notes: string | null
          wins_shared: string | null
        }
        Insert: {
          client_experience_done?: boolean | null
          created_at?: string
          id?: string
          member_id: string
          report_date: string
          report_type?: string
          self_assessment?: number | null
          tasks_snapshot?: Json | null
          top_priorities?: Json | null
          touchpoint_count?: number | null
          touchpoint_notes?: string | null
          wins_shared?: string | null
        }
        Update: {
          client_experience_done?: boolean | null
          created_at?: string
          id?: string
          member_id?: string
          report_date?: string
          report_type?: string
          self_assessment?: number | null
          tasks_snapshot?: Json | null
          top_priorities?: Json | null
          touchpoint_count?: number | null
          touchpoint_notes?: string | null
          wins_shared?: string | null
        }
        Relationships: []
      }
      dashboard_preferences: {
        Row: {
          chart_config: Json | null
          client_id: string | null
          created_at: string
          custom_metrics: Json | null
          hidden_metrics: string[] | null
          id: string
          preference_type: string
          updated_at: string
        }
        Insert: {
          chart_config?: Json | null
          client_id?: string | null
          created_at?: string
          custom_metrics?: Json | null
          hidden_metrics?: string[] | null
          id?: string
          preference_type?: string
          updated_at?: string
        }
        Update: {
          chart_config?: Json | null
          client_id?: string | null
          created_at?: string
          custom_metrics?: Json | null
          hidden_metrics?: string[] | null
          id?: string
          preference_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_preferences_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "dashboard_preferences_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_preferences_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      data_discrepancies: {
        Row: {
          api_count: number
          client_id: string
          date_range_end: string
          date_range_start: string
          db_count: number
          detected_at: string
          difference: number
          discrepancy_type: string
          id: string
          resolution_notes: string | null
          resolved_at: string | null
          severity: string
          status: string
          sync_log_id: string | null
          webhook_count: number
        }
        Insert: {
          api_count?: number
          client_id: string
          date_range_end: string
          date_range_start: string
          db_count?: number
          detected_at?: string
          difference?: number
          discrepancy_type: string
          id?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          severity?: string
          status?: string
          sync_log_id?: string | null
          webhook_count?: number
        }
        Update: {
          api_count?: number
          client_id?: string
          date_range_end?: string
          date_range_start?: string
          db_count?: number
          detected_at?: string
          difference?: number
          discrepancy_type?: string
          id?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          severity?: string
          status?: string
          sync_log_id?: string | null
          webhook_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "data_discrepancies_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "data_discrepancies_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_discrepancies_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "data_discrepancies_sync_log_id_fkey"
            columns: ["sync_log_id"]
            isOneToOne: false
            referencedRelation: "sync_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_activities: {
        Row: {
          activity_type: string
          created_at: string
          created_by: string | null
          deal_id: string
          description: string | null
          id: string
        }
        Insert: {
          activity_type?: string
          created_at?: string
          created_by?: string | null
          deal_id: string
          description?: string | null
          id?: string
        }
        Update: {
          activity_type?: string
          created_at?: string
          created_by?: string | null
          deal_id?: string
          description?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_activities_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          assigned_to: string | null
          client_id: string
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          deal_name: string
          deal_value: number
          expected_close_date: string | null
          id: string
          last_activity_at: string | null
          notes: string | null
          probability: number
          source: string | null
          stage: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          client_id: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          deal_name: string
          deal_value?: number
          expected_close_date?: string | null
          id?: string
          last_activity_at?: string | null
          notes?: string | null
          probability?: number
          source?: string | null
          stage?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          client_id?: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          deal_name?: string
          deal_value?: number
          expected_close_date?: string | null
          id?: string
          last_activity_at?: string | null
          notes?: string | null
          probability?: number
          source?: string | null
          stage?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "deals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      email_assignments: {
        Row: {
          assigned_by: string | null
          assigned_to: string | null
          completed_at: string | null
          created_at: string
          due_date: string | null
          email_id: string
          id: string
          status: string | null
          updated_at: string
        }
        Insert: {
          assigned_by?: string | null
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          due_date?: string | null
          email_id: string
          id?: string
          status?: string | null
          updated_at?: string
        }
        Update: {
          assigned_by?: string | null
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          due_date?: string | null
          email_id?: string
          id?: string
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "agency_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_assignments_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "agency_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_assignments_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "emails"
            referencedColumns: ["id"]
          },
        ]
      }
      email_briefings: {
        Row: {
          briefing_date: string
          created_at: string
          follow_ups: Json | null
          id: string
          metrics: Json | null
          pending_replies: Json | null
          summary: string | null
          top_emails: Json | null
          urgent_items: Json | null
        }
        Insert: {
          briefing_date: string
          created_at?: string
          follow_ups?: Json | null
          id?: string
          metrics?: Json | null
          pending_replies?: Json | null
          summary?: string | null
          top_emails?: Json | null
          urgent_items?: Json | null
        }
        Update: {
          briefing_date?: string
          created_at?: string
          follow_ups?: Json | null
          id?: string
          metrics?: Json | null
          pending_replies?: Json | null
          summary?: string | null
          top_emails?: Json | null
          urgent_items?: Json | null
        }
        Relationships: []
      }
      email_drafts: {
        Row: {
          body: string
          confidence: number | null
          created_at: string
          edited_body: string | null
          email_id: string
          id: string
          model: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["email_draft_status"] | null
          updated_at: string
          urgency: Database["public"]["Enums"]["email_priority"] | null
        }
        Insert: {
          body: string
          confidence?: number | null
          created_at?: string
          edited_body?: string | null
          email_id: string
          id?: string
          model?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["email_draft_status"] | null
          updated_at?: string
          urgency?: Database["public"]["Enums"]["email_priority"] | null
        }
        Update: {
          body?: string
          confidence?: number | null
          created_at?: string
          edited_body?: string | null
          email_id?: string
          id?: string
          model?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["email_draft_status"] | null
          updated_at?: string
          urgency?: Database["public"]["Enums"]["email_priority"] | null
        }
        Relationships: [
          {
            foreignKeyName: "email_drafts_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "emails"
            referencedColumns: ["id"]
          },
        ]
      }
      email_notes: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          email_id: string
          id: string
          mentions: string[] | null
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          email_id: string
          id?: string
          mentions?: string[] | null
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          email_id?: string
          id?: string
          mentions?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "email_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "agency_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_notes_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "emails"
            referencedColumns: ["id"]
          },
        ]
      }
      email_parsed_investors: {
        Row: {
          client_id: string
          created_at: string
          email_body: string | null
          email_from: string | null
          email_received_at: string | null
          email_subject: string | null
          funded_investor_id: string | null
          id: string
          parsed_accredited: boolean | null
          parsed_amount: number | null
          parsed_class: string | null
          parsed_email: string | null
          parsed_name: string | null
          parsed_offering: string | null
          parsed_phone: string | null
          raw_parsed_data: Json | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          client_id: string
          created_at?: string
          email_body?: string | null
          email_from?: string | null
          email_received_at?: string | null
          email_subject?: string | null
          funded_investor_id?: string | null
          id?: string
          parsed_accredited?: boolean | null
          parsed_amount?: number | null
          parsed_class?: string | null
          parsed_email?: string | null
          parsed_name?: string | null
          parsed_offering?: string | null
          parsed_phone?: string | null
          raw_parsed_data?: Json | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          email_body?: string | null
          email_from?: string | null
          email_received_at?: string | null
          email_subject?: string | null
          funded_investor_id?: string | null
          id?: string
          parsed_accredited?: boolean | null
          parsed_amount?: number | null
          parsed_class?: string | null
          parsed_email?: string | null
          parsed_name?: string | null
          parsed_offering?: string | null
          parsed_phone?: string | null
          raw_parsed_data?: Json | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_parsed_investors_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "email_parsed_investors_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_parsed_investors_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "email_parsed_investors_funded_investor_id_fkey"
            columns: ["funded_investor_id"]
            isOneToOne: false
            referencedRelation: "funded_investors"
            referencedColumns: ["id"]
          },
        ]
      }
      email_sync_log: {
        Row: {
          account_id: string | null
          error_message: string | null
          finished_at: string | null
          id: string
          messages_auto_archived: number | null
          messages_classified: number | null
          messages_synced: number | null
          started_at: string
          status: string
        }
        Insert: {
          account_id?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          messages_auto_archived?: number | null
          messages_classified?: number | null
          messages_synced?: number | null
          started_at?: string
          status?: string
        }
        Update: {
          account_id?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          messages_auto_archived?: number | null
          messages_classified?: number | null
          messages_synced?: number | null
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_sync_log_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "gmail_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sync_log_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "v_gmail_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      emails: {
        Row: {
          account_id: string
          auto_archived: boolean | null
          body_html: string | null
          body_text: string | null
          cc_emails: string[] | null
          classification:
            | Database["public"]["Enums"]["email_classification"]
            | null
          classified_at: string | null
          created_at: string
          from_email: string | null
          from_name: string | null
          gmail_id: string
          id: string
          is_archived: boolean | null
          is_unread: boolean | null
          labels: string[] | null
          priority: Database["public"]["Enums"]["email_priority"] | null
          raw_payload: Json | null
          received_at: string | null
          requires_response: boolean | null
          responded_at: string | null
          snippet: string | null
          subject: string | null
          thread_id: string | null
          to_emails: string[] | null
          updated_at: string
          waiting_on_customer: boolean | null
        }
        Insert: {
          account_id: string
          auto_archived?: boolean | null
          body_html?: string | null
          body_text?: string | null
          cc_emails?: string[] | null
          classification?:
            | Database["public"]["Enums"]["email_classification"]
            | null
          classified_at?: string | null
          created_at?: string
          from_email?: string | null
          from_name?: string | null
          gmail_id: string
          id?: string
          is_archived?: boolean | null
          is_unread?: boolean | null
          labels?: string[] | null
          priority?: Database["public"]["Enums"]["email_priority"] | null
          raw_payload?: Json | null
          received_at?: string | null
          requires_response?: boolean | null
          responded_at?: string | null
          snippet?: string | null
          subject?: string | null
          thread_id?: string | null
          to_emails?: string[] | null
          updated_at?: string
          waiting_on_customer?: boolean | null
        }
        Update: {
          account_id?: string
          auto_archived?: boolean | null
          body_html?: string | null
          body_text?: string | null
          cc_emails?: string[] | null
          classification?:
            | Database["public"]["Enums"]["email_classification"]
            | null
          classified_at?: string | null
          created_at?: string
          from_email?: string | null
          from_name?: string | null
          gmail_id?: string
          id?: string
          is_archived?: boolean | null
          is_unread?: boolean | null
          labels?: string[] | null
          priority?: Database["public"]["Enums"]["email_priority"] | null
          raw_payload?: Json | null
          received_at?: string | null
          requires_response?: boolean | null
          responded_at?: string | null
          snippet?: string | null
          subject?: string | null
          thread_id?: string | null
          to_emails?: string[] | null
          updated_at?: string
          waiting_on_customer?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "emails_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "gmail_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emails_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "v_gmail_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      enrichment_alerts: {
        Row: {
          client_id: string | null
          created_at: string
          id: string
          message: string | null
          resolved_at: string | null
          severity: string
          type: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          id?: string
          message?: string | null
          resolved_at?: string | null
          severity?: string
          type: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          id?: string
          message?: string | null
          resolved_at?: string | null
          severity?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrichment_alerts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "enrichment_alerts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrichment_alerts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      enrichment_jobs: {
        Row: {
          client_id: string
          created_at: string
          error: string | null
          failed: number
          finished_at: string | null
          id: string
          last_offset: number
          processed: number
          started_at: string | null
          status: string
          succeeded: number
          total: number
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          error?: string | null
          failed?: number
          finished_at?: string | null
          id?: string
          last_offset?: number
          processed?: number
          started_at?: string | null
          status?: string
          succeeded?: number
          total?: number
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          error?: string | null
          failed?: number
          finished_at?: string | null
          id?: string
          last_offset?: number
          processed?: number
          started_at?: string | null
          status?: string
          succeeded?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrichment_jobs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "enrichment_jobs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrichment_jobs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      enrichment_run_log: {
        Row: {
          client_id: string | null
          created_at: string
          duration_ms: number | null
          failed: number
          id: string
          processed: number
          run_date: string
          skipped_recent: number
          succeeded: number
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          duration_ms?: number | null
          failed?: number
          id?: string
          processed?: number
          run_date?: string
          skipped_recent?: number
          succeeded?: number
        }
        Update: {
          client_id?: string | null
          created_at?: string
          duration_ms?: number | null
          failed?: number
          id?: string
          processed?: number
          run_date?: string
          skipped_recent?: number
          succeeded?: number
        }
        Relationships: [
          {
            foreignKeyName: "enrichment_run_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "enrichment_run_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrichment_run_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      flowboards: {
        Row: {
          client_id: string | null
          created_at: string | null
          description: string | null
          edges: Json | null
          id: string
          name: string
          nodes: Json | null
          status: string | null
          updated_at: string | null
          viewport: Json | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          description?: string | null
          edges?: Json | null
          id?: string
          name: string
          nodes?: Json | null
          status?: string | null
          updated_at?: string | null
          viewport?: Json | null
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          description?: string | null
          edges?: Json | null
          id?: string
          name?: string
          nodes?: Json | null
          status?: string | null
          updated_at?: string | null
          viewport?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "flowboards_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "flowboards_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flowboards_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      fulfillment_runs: {
        Row: {
          client_id: string
          completed_at: string | null
          completed_steps: number | null
          config: Json | null
          created_at: string
          current_phase: string | null
          error_summary: string | null
          failed_steps: number | null
          id: string
          offer_id: string | null
          run_mode: string
          started_at: string | null
          status: string
          total_steps: number | null
          updated_at: string
        }
        Insert: {
          client_id: string
          completed_at?: string | null
          completed_steps?: number | null
          config?: Json | null
          created_at?: string
          current_phase?: string | null
          error_summary?: string | null
          failed_steps?: number | null
          id?: string
          offer_id?: string | null
          run_mode?: string
          started_at?: string | null
          status?: string
          total_steps?: number | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          completed_at?: string | null
          completed_steps?: number | null
          config?: Json | null
          created_at?: string
          current_phase?: string | null
          error_summary?: string | null
          failed_steps?: number | null
          id?: string
          offer_id?: string | null
          run_mode?: string
          started_at?: string | null
          status?: string
          total_steps?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fulfillment_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "fulfillment_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fulfillment_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "fulfillment_runs_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "client_offers"
            referencedColumns: ["id"]
          },
        ]
      }
      fulfillment_steps: {
        Row: {
          asset_id: string | null
          completed_at: string | null
          created_at: string
          depends_on: string[] | null
          duration_ms: number | null
          error_message: string | null
          function_name: string | null
          function_params: Json | null
          id: string
          max_retries: number | null
          output_data: Json | null
          phase: string
          retry_count: number | null
          run_id: string
          sort_order: number | null
          started_at: string | null
          status: string
          step_name: string
          step_type: string
        }
        Insert: {
          asset_id?: string | null
          completed_at?: string | null
          created_at?: string
          depends_on?: string[] | null
          duration_ms?: number | null
          error_message?: string | null
          function_name?: string | null
          function_params?: Json | null
          id?: string
          max_retries?: number | null
          output_data?: Json | null
          phase: string
          retry_count?: number | null
          run_id: string
          sort_order?: number | null
          started_at?: string | null
          status?: string
          step_name: string
          step_type?: string
        }
        Update: {
          asset_id?: string | null
          completed_at?: string | null
          created_at?: string
          depends_on?: string[] | null
          duration_ms?: number | null
          error_message?: string | null
          function_name?: string | null
          function_params?: Json | null
          id?: string
          max_retries?: number | null
          output_data?: Json | null
          phase?: string
          retry_count?: number | null
          run_id?: string
          sort_order?: number | null
          started_at?: string | null
          status?: string
          step_name?: string
          step_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "fulfillment_steps_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "fulfillment_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      fundad_creatives: {
        Row: {
          ad_title: string | null
          batch_id: string
          captions: Json | null
          character_desc: string | null
          client_id: string | null
          compliance_disclaimer: string | null
          created_at: string
          creative_index: number
          creative_type: string
          cta: string | null
          fund_input: Json
          fund_name: string
          hook: string | null
          id: string
          is_variation: boolean
          scene_breakdown: Json | null
          scene_location: string | null
          script: string | null
          seedance_prompt: string | null
          updated_at: string
          user_id: string
          video_model: string | null
          video_model_alt: string | null
          video_status: string | null
          video_status_alt: string | null
          video_url: string | null
          video_url_alt: string | null
        }
        Insert: {
          ad_title?: string | null
          batch_id: string
          captions?: Json | null
          character_desc?: string | null
          client_id?: string | null
          compliance_disclaimer?: string | null
          created_at?: string
          creative_index?: number
          creative_type: string
          cta?: string | null
          fund_input?: Json
          fund_name: string
          hook?: string | null
          id?: string
          is_variation?: boolean
          scene_breakdown?: Json | null
          scene_location?: string | null
          script?: string | null
          seedance_prompt?: string | null
          updated_at?: string
          user_id: string
          video_model?: string | null
          video_model_alt?: string | null
          video_status?: string | null
          video_status_alt?: string | null
          video_url?: string | null
          video_url_alt?: string | null
        }
        Update: {
          ad_title?: string | null
          batch_id?: string
          captions?: Json | null
          character_desc?: string | null
          client_id?: string | null
          compliance_disclaimer?: string | null
          created_at?: string
          creative_index?: number
          creative_type?: string
          cta?: string | null
          fund_input?: Json
          fund_name?: string
          hook?: string | null
          id?: string
          is_variation?: boolean
          scene_breakdown?: Json | null
          scene_location?: string | null
          script?: string | null
          seedance_prompt?: string | null
          updated_at?: string
          user_id?: string
          video_model?: string | null
          video_model_alt?: string | null
          video_status?: string | null
          video_status_alt?: string | null
          video_url?: string | null
          video_url_alt?: string | null
        }
        Relationships: []
      }
      funded_investors: {
        Row: {
          approval_status: string | null
          calls_to_fund: number | null
          client_id: string
          commitment_amount: number | null
          created_at: string
          external_id: string
          first_contact_at: string | null
          funded_amount: number
          funded_at: string
          id: string
          lead_id: string | null
          name: string | null
          source: string | null
          time_to_fund_days: number | null
        }
        Insert: {
          approval_status?: string | null
          calls_to_fund?: number | null
          client_id: string
          commitment_amount?: number | null
          created_at?: string
          external_id: string
          first_contact_at?: string | null
          funded_amount?: number
          funded_at?: string
          id?: string
          lead_id?: string | null
          name?: string | null
          source?: string | null
          time_to_fund_days?: number | null
        }
        Update: {
          approval_status?: string | null
          calls_to_fund?: number | null
          client_id?: string
          commitment_amount?: number | null
          created_at?: string
          external_id?: string
          first_contact_at?: string | null
          funded_amount?: number
          funded_at?: string
          id?: string
          lead_id?: string | null
          name?: string | null
          source?: string | null
          time_to_fund_days?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "funded_investors_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "funded_investors_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funded_investors_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "funded_investors_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      funnel_analytics: {
        Row: {
          completions: number | null
          conversion_rate: number | null
          created_at: string | null
          date: string
          funnel_id: string | null
          id: string
          page_type: string | null
          visitors: number | null
        }
        Insert: {
          completions?: number | null
          conversion_rate?: number | null
          created_at?: string | null
          date: string
          funnel_id?: string | null
          id?: string
          page_type?: string | null
          visitors?: number | null
        }
        Update: {
          completions?: number | null
          conversion_rate?: number | null
          created_at?: string | null
          date?: string
          funnel_id?: string | null
          id?: string
          page_type?: string | null
          visitors?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "funnel_analytics_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
        ]
      }
      funnel_bookings: {
        Row: {
          booked_at: string | null
          created_at: string | null
          email: string | null
          funnel_id: string | null
          ghl_contact_id: string | null
          id: string
          name: string | null
          phone: string | null
          status: string | null
          timezone: string | null
        }
        Insert: {
          booked_at?: string | null
          created_at?: string | null
          email?: string | null
          funnel_id?: string | null
          ghl_contact_id?: string | null
          id?: string
          name?: string | null
          phone?: string | null
          status?: string | null
          timezone?: string | null
        }
        Update: {
          booked_at?: string | null
          created_at?: string | null
          email?: string | null
          funnel_id?: string | null
          ghl_contact_id?: string | null
          id?: string
          name?: string | null
          phone?: string | null
          status?: string | null
          timezone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "funnel_bookings_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
        ]
      }
      funnel_campaigns: {
        Row: {
          client_id: string
          color: string | null
          created_at: string | null
          id: string
          name: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          client_id: string
          color?: string | null
          created_at?: string | null
          id?: string
          name: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          client_id?: string
          color?: string | null
          created_at?: string | null
          id?: string
          name?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "funnel_campaigns_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "funnel_campaigns_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funnel_campaigns_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      funnel_onboarding_submissions: {
        Row: {
          assets_url: string | null
          client_name: string | null
          company_name: string | null
          fund_type: string | null
          funnel_id: string | null
          id: string
          min_investment: string | null
          notes: string | null
          raise_goal: string | null
          status: string | null
          submitted_at: string | null
          timeline: string | null
          website: string | null
        }
        Insert: {
          assets_url?: string | null
          client_name?: string | null
          company_name?: string | null
          fund_type?: string | null
          funnel_id?: string | null
          id?: string
          min_investment?: string | null
          notes?: string | null
          raise_goal?: string | null
          status?: string | null
          submitted_at?: string | null
          timeline?: string | null
          website?: string | null
        }
        Update: {
          assets_url?: string | null
          client_name?: string | null
          company_name?: string | null
          fund_type?: string | null
          funnel_id?: string | null
          id?: string
          min_investment?: string | null
          notes?: string | null
          raise_goal?: string | null
          status?: string | null
          submitted_at?: string | null
          timeline?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "funnel_onboarding_submissions_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
        ]
      }
      funnel_pages: {
        Row: {
          created_at: string | null
          funnel_id: string | null
          id: string
          page_type: string
          settings: Json | null
          sort_order: number | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          funnel_id?: string | null
          id?: string
          page_type?: string
          settings?: Json | null
          sort_order?: number | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          funnel_id?: string | null
          id?: string
          page_type?: string
          settings?: Json | null
          sort_order?: number | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "funnel_pages_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
        ]
      }
      funnel_snapshots: {
        Row: {
          client_id: string
          conversion_rate: number | null
          count: number
          created_at: string
          id: string
          snapshot_date: string
          stage_id: string
        }
        Insert: {
          client_id: string
          conversion_rate?: number | null
          count?: number
          created_at?: string
          id?: string
          snapshot_date: string
          stage_id: string
        }
        Update: {
          client_id?: string
          conversion_rate?: number | null
          count?: number
          created_at?: string
          id?: string
          snapshot_date?: string
          stage_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "funnel_snapshots_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "funnel_snapshots_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funnel_snapshots_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "funnel_snapshots_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "funnel_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      funnel_stages: {
        Row: {
          client_id: string
          conversion_count: number
          created_at: string
          id: string
          stage_name: string
          stage_order: number
          stage_url: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          conversion_count?: number
          created_at?: string
          id?: string
          stage_name: string
          stage_order?: number
          stage_url?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          conversion_count?: number
          created_at?: string
          id?: string
          stage_name?: string
          stage_order?: number
          stage_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "funnel_stages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "funnel_stages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funnel_stages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      funnel_step_metadata: {
        Row: {
          created_at: string
          description: string | null
          favicon: string | null
          fetched_at: string
          id: string
          image: string | null
          site_name: string | null
          step_id: string
          title: string | null
          url: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          favicon?: string | null
          fetched_at?: string
          id?: string
          image?: string | null
          site_name?: string | null
          step_id: string
          title?: string | null
          url: string
        }
        Update: {
          created_at?: string
          description?: string | null
          favicon?: string | null
          fetched_at?: string
          id?: string
          image?: string | null
          site_name?: string | null
          step_id?: string
          title?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "funnel_step_metadata_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: true
            referencedRelation: "client_funnel_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      funnel_step_variants: {
        Row: {
          created_at: string | null
          id: string
          name: string
          sort_order: number | null
          step_id: string
          updated_at: string | null
          url: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name?: string
          sort_order?: number | null
          step_id: string
          updated_at?: string | null
          url: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          sort_order?: number | null
          step_id?: string
          updated_at?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "funnel_step_variants_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "client_funnel_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      funnels: {
        Row: {
          client_id: string | null
          created_at: string | null
          custom_domain: string | null
          ghl_webhook_url: string | null
          id: string
          meta_pixel_id: string | null
          name: string
          slug: string | null
          status: string | null
          stripe_price_id: string | null
          updated_at: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          custom_domain?: string | null
          ghl_webhook_url?: string | null
          id?: string
          meta_pixel_id?: string | null
          name: string
          slug?: string | null
          status?: string | null
          stripe_price_id?: string | null
          updated_at?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          custom_domain?: string | null
          ghl_webhook_url?: string | null
          id?: string
          meta_pixel_id?: string | null
          name?: string
          slug?: string | null
          status?: string | null
          stripe_price_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "funnels_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "funnels_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funnels_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      ghl_outbound_log: {
        Row: {
          attempt_number: number | null
          client_id: string | null
          completed_at: string | null
          correlation_id: string | null
          created_at: string
          duration_ms: number | null
          endpoint: string
          error_class: string | null
          error_message: string | null
          final_state: string
          function_name: string
          ghl_contact_id: string | null
          http_method: string
          id: string
          lead_id: string | null
          request_payload: Json | null
          response_body: Json | null
          response_status_code: number | null
        }
        Insert: {
          attempt_number?: number | null
          client_id?: string | null
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string
          duration_ms?: number | null
          endpoint: string
          error_class?: string | null
          error_message?: string | null
          final_state?: string
          function_name: string
          ghl_contact_id?: string | null
          http_method?: string
          id?: string
          lead_id?: string | null
          request_payload?: Json | null
          response_body?: Json | null
          response_status_code?: number | null
        }
        Update: {
          attempt_number?: number | null
          client_id?: string | null
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string
          duration_ms?: number | null
          endpoint?: string
          error_class?: string | null
          error_message?: string | null
          final_state?: string
          function_name?: string
          ghl_contact_id?: string | null
          http_method?: string
          id?: string
          lead_id?: string | null
          request_payload?: Json | null
          response_body?: Json | null
          response_status_code?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ghl_outbound_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "ghl_outbound_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ghl_outbound_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "ghl_outbound_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      ghl_reconciliation_results: {
        Row: {
          client_id: string
          created_at: string
          extra_in_ghl: number
          ghl_contact_count: number
          id: string
          local_lead_count: number
          matched_count: number
          missing_in_ghl: number
          notes: string | null
          reconciliation_date: string
          sample_missing_lead_ids: string[] | null
        }
        Insert: {
          client_id: string
          created_at?: string
          extra_in_ghl?: number
          ghl_contact_count?: number
          id?: string
          local_lead_count?: number
          matched_count?: number
          missing_in_ghl?: number
          notes?: string | null
          reconciliation_date?: string
          sample_missing_lead_ids?: string[] | null
        }
        Update: {
          client_id?: string
          created_at?: string
          extra_in_ghl?: number
          ghl_contact_count?: number
          id?: string
          local_lead_count?: number
          matched_count?: number
          missing_in_ghl?: number
          notes?: string | null
          reconciliation_date?: string
          sample_missing_lead_ids?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "ghl_reconciliation_results_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "ghl_reconciliation_results_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ghl_reconciliation_results_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      gmail_accounts: {
        Row: {
          access_token: string | null
          access_token_expires_at: string | null
          created_at: string
          display_name: string | null
          email: string
          history_id: string | null
          id: string
          last_synced_at: string | null
          owner_member_id: string | null
          refresh_token: string
          scope: string | null
          status: string
          updated_at: string
        }
        Insert: {
          access_token?: string | null
          access_token_expires_at?: string | null
          created_at?: string
          display_name?: string | null
          email: string
          history_id?: string | null
          id?: string
          last_synced_at?: string | null
          owner_member_id?: string | null
          refresh_token: string
          scope?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          access_token?: string | null
          access_token_expires_at?: string | null
          created_at?: string
          display_name?: string | null
          email?: string
          history_id?: string | null
          id?: string
          last_synced_at?: string | null
          owner_member_id?: string | null
          refresh_token?: string
          scope?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gmail_accounts_owner_member_id_fkey"
            columns: ["owner_member_id"]
            isOneToOne: false
            referencedRelation: "agency_members"
            referencedColumns: ["id"]
          },
        ]
      }
      gpt_files: {
        Row: {
          character_count: number | null
          content: string | null
          created_at: string
          estimated_tokens: number | null
          file_type: string
          file_url: string | null
          gpt_id: string
          id: string
          name: string
          website_url: string | null
        }
        Insert: {
          character_count?: number | null
          content?: string | null
          created_at?: string
          estimated_tokens?: number | null
          file_type?: string
          file_url?: string | null
          gpt_id: string
          id?: string
          name: string
          website_url?: string | null
        }
        Update: {
          character_count?: number | null
          content?: string | null
          created_at?: string
          estimated_tokens?: number | null
          file_type?: string
          file_url?: string | null
          gpt_id?: string
          id?: string
          name?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gpt_files_gpt_id_fkey"
            columns: ["gpt_id"]
            isOneToOne: false
            referencedRelation: "custom_gpts"
            referencedColumns: ["id"]
          },
        ]
      }
      gpt_knowledge_base: {
        Row: {
          created_at: string
          document_id: string
          gpt_id: string
          id: string
        }
        Insert: {
          created_at?: string
          document_id: string
          gpt_id: string
          id?: string
        }
        Update: {
          created_at?: string
          document_id?: string
          gpt_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gpt_knowledge_base_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "knowledge_base_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gpt_knowledge_base_gpt_id_fkey"
            columns: ["gpt_id"]
            isOneToOne: false
            referencedRelation: "custom_gpts"
            referencedColumns: ["id"]
          },
        ]
      }
      hermes_tasks: {
        Row: {
          agent_id: string | null
          client_id: string
          completed_at: string | null
          conversation_id: string | null
          created_at: string
          delivered_at: string | null
          error_message: string | null
          hermes_callback_url: string | null
          hermes_external_id: string | null
          id: string
          instructions: string
          metadata: Json
          result_assets: Json
          status: string
          task_type: string
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          client_id: string
          completed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          delivered_at?: string | null
          error_message?: string | null
          hermes_callback_url?: string | null
          hermes_external_id?: string | null
          id?: string
          instructions: string
          metadata?: Json
          result_assets?: Json
          status?: string
          task_type: string
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          client_id?: string
          completed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          delivered_at?: string | null
          error_message?: string | null
          hermes_callback_url?: string | null
          hermes_external_id?: string | null
          id?: string
          instructions?: string
          metadata?: Json
          result_assets?: Json
          status?: string
          task_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hermes_tasks_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "client_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hermes_tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "hermes_tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hermes_tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "hermes_tasks_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_studio_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      instagram_creatives: {
        Row: {
          caption: string | null
          client_id: string | null
          comments: number | null
          comments_count: number | null
          created_at: string | null
          engagement_rate: number | null
          hashtags: string[] | null
          id: string
          image_url: string | null
          is_inspiration_source: boolean | null
          likes: number | null
          likes_count: number | null
          media_url: string | null
          owner_username: string | null
          platform_post_id: string | null
          post_type: string | null
          source_url: string | null
          status: string | null
          thumbnail_url: string | null
          video_url: string | null
          views_count: number | null
        }
        Insert: {
          caption?: string | null
          client_id?: string | null
          comments?: number | null
          comments_count?: number | null
          created_at?: string | null
          engagement_rate?: number | null
          hashtags?: string[] | null
          id?: string
          image_url?: string | null
          is_inspiration_source?: boolean | null
          likes?: number | null
          likes_count?: number | null
          media_url?: string | null
          owner_username?: string | null
          platform_post_id?: string | null
          post_type?: string | null
          source_url?: string | null
          status?: string | null
          thumbnail_url?: string | null
          video_url?: string | null
          views_count?: number | null
        }
        Update: {
          caption?: string | null
          client_id?: string | null
          comments?: number | null
          comments_count?: number | null
          created_at?: string | null
          engagement_rate?: number | null
          hashtags?: string[] | null
          id?: string
          image_url?: string | null
          is_inspiration_source?: boolean | null
          likes?: number | null
          likes_count?: number | null
          media_url?: string | null
          owner_username?: string | null
          platform_post_id?: string | null
          post_type?: string | null
          source_url?: string | null
          status?: string | null
          thumbnail_url?: string | null
          video_url?: string | null
          views_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "instagram_creatives_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "instagram_creatives_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instagram_creatives_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      instagram_scrape_jobs: {
        Row: {
          client_id: string | null
          completed_at: string | null
          cost_usd: number | null
          created_at: string | null
          error_message: string | null
          id: string
          input_params: Json | null
          posts_found: number | null
          posts_processed: number | null
          results_count: number | null
          started_at: string | null
          status: string | null
          target_handle: string
        }
        Insert: {
          client_id?: string | null
          completed_at?: string | null
          cost_usd?: number | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          input_params?: Json | null
          posts_found?: number | null
          posts_processed?: number | null
          results_count?: number | null
          started_at?: string | null
          status?: string | null
          target_handle: string
        }
        Update: {
          client_id?: string | null
          completed_at?: string | null
          cost_usd?: number | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          input_params?: Json | null
          posts_found?: number | null
          posts_processed?: number | null
          results_count?: number | null
          started_at?: string | null
          status?: string | null
          target_handle?: string
        }
        Relationships: [
          {
            foreignKeyName: "instagram_scrape_jobs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "instagram_scrape_jobs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instagram_scrape_jobs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      integration_status: {
        Row: {
          client_id: string | null
          created_at: string
          error_count: number
          id: string
          integration_name: string
          is_connected: boolean
          last_error_message: string | null
          last_sync_at: string | null
          last_sync_status: string | null
          records_synced: number
          token_expires_at: string | null
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          error_count?: number
          id?: string
          integration_name: string
          is_connected?: boolean
          last_error_message?: string | null
          last_sync_at?: string | null
          last_sync_status?: string | null
          records_synced?: number
          token_expires_at?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          error_count?: number
          id?: string
          integration_name?: string
          is_connected?: boolean
          last_error_message?: string | null
          last_sync_at?: string | null
          last_sync_status?: string | null
          records_synced?: number
          token_expires_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_status_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "integration_status_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_status_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      knowledge_base_documents: {
        Row: {
          character_count: number | null
          content: string | null
          created_at: string
          document_type: string
          estimated_tokens: number | null
          extracted_text: string | null
          file_url: string | null
          id: string
          metadata: Json | null
          name: string
          updated_at: string
          website_url: string | null
        }
        Insert: {
          character_count?: number | null
          content?: string | null
          created_at?: string
          document_type?: string
          estimated_tokens?: number | null
          extracted_text?: string | null
          file_url?: string | null
          id?: string
          metadata?: Json | null
          name: string
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          character_count?: number | null
          content?: string | null
          created_at?: string
          document_type?: string
          estimated_tokens?: number | null
          extracted_text?: string | null
          file_url?: string | null
          id?: string
          metadata?: Json | null
          name?: string
          updated_at?: string
          website_url?: string | null
        }
        Relationships: []
      }
      lead_change_log: {
        Row: {
          action: string
          changed_fields: Json | null
          client_id: string
          created_at: string
          external_id: string | null
          id: string
          job_id: string | null
          lead_id: string | null
          provider: string | null
          source: string
        }
        Insert: {
          action: string
          changed_fields?: Json | null
          client_id: string
          created_at?: string
          external_id?: string | null
          id?: string
          job_id?: string | null
          lead_id?: string | null
          provider?: string | null
          source: string
        }
        Update: {
          action?: string
          changed_fields?: Json | null
          client_id?: string
          created_at?: string
          external_id?: string | null
          id?: string
          job_id?: string | null
          lead_id?: string | null
          provider?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_change_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "lead_change_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_change_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "lead_change_log_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "sync_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_change_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_enrichment: {
        Row: {
          accredited_probability: string | null
          address: string | null
          affinities: Json | null
          age: number | null
          amex_card: boolean | null
          bank_card: boolean | null
          birth_date: string | null
          birth_year: number | null
          blue_collar: boolean | null
          business_owner: boolean | null
          city: string | null
          client_id: string
          companies: Json | null
          company_name: string | null
          company_title: string | null
          confidence_score: number | null
          congressional_district: string | null
          county_name: string | null
          created_at: string
          credit_card: boolean | null
          credit_midpoint: number | null
          credit_range: string | null
          discretionary_income: string | null
          dma: number | null
          donation_history: Json | null
          dwelling_type: string | null
          education: string | null
          enriched_at: string
          enriched_emails: Json | null
          enriched_phones: Json | null
          enrichment_match_count: number | null
          enrichment_methods_used: string[] | null
          enrichment_version: number | null
          estimated_income: number | null
          ethnicity: string | null
          ethnicity_detail: string | null
          external_id: string
          financial_power: number | null
          first_name: string | null
          gender: string | null
          generation: string | null
          has_children: boolean | null
          home_equity: number | null
          home_ownership: string | null
          home_purchased_years_ago: number | null
          home_value: number | null
          household_adults: number | null
          household_income: string | null
          household_income_midpoint: number | null
          household_persons: number | null
          id: string
          income_level: string | null
          interests: Json | null
          investor_score: number | null
          is_investor: boolean | null
          is_primary_identity: boolean | null
          is_veteran: boolean | null
          language: string | null
          last_enriched_at: string | null
          last_name: string | null
          latitude: number | null
          lead_id: string | null
          length_of_residence: number | null
          likely_charitable_donor: boolean | null
          linkedin_url: string | null
          longitude: number | null
          marital_status: string | null
          median_home_value: number | null
          median_income: number | null
          mortgage_amount: number | null
          mortgage_refinance_age: number | null
          mortgage_refinance_amount: number | null
          multilingual: boolean | null
          net_worth: string | null
          net_worth_midpoint: number | null
          occupation: string | null
          occupation_category: string | null
          occupation_type: string | null
          owns_investments: boolean | null
          owns_mutual_funds: boolean | null
          owns_stocks_bonds: boolean | null
          owns_swimming_pool: boolean | null
          political_contributor: boolean | null
          premium_amex_card: boolean | null
          premium_card: boolean | null
          purchase_behavior: Json | null
          raw_data: Json
          reading_interests: Json | null
          religion: string | null
          retargetiq_id: number | null
          single_family_dwelling: boolean | null
          source: string
          speaks_english: boolean | null
          spouse_data: Json | null
          state: string | null
          urbanicity: string | null
          vehicle_summary: Json | null
          vehicles: Json | null
          voter: boolean | null
          white_collar: boolean | null
          zip: string | null
        }
        Insert: {
          accredited_probability?: string | null
          address?: string | null
          affinities?: Json | null
          age?: number | null
          amex_card?: boolean | null
          bank_card?: boolean | null
          birth_date?: string | null
          birth_year?: number | null
          blue_collar?: boolean | null
          business_owner?: boolean | null
          city?: string | null
          client_id: string
          companies?: Json | null
          company_name?: string | null
          company_title?: string | null
          confidence_score?: number | null
          congressional_district?: string | null
          county_name?: string | null
          created_at?: string
          credit_card?: boolean | null
          credit_midpoint?: number | null
          credit_range?: string | null
          discretionary_income?: string | null
          dma?: number | null
          donation_history?: Json | null
          dwelling_type?: string | null
          education?: string | null
          enriched_at?: string
          enriched_emails?: Json | null
          enriched_phones?: Json | null
          enrichment_match_count?: number | null
          enrichment_methods_used?: string[] | null
          enrichment_version?: number | null
          estimated_income?: number | null
          ethnicity?: string | null
          ethnicity_detail?: string | null
          external_id: string
          financial_power?: number | null
          first_name?: string | null
          gender?: string | null
          generation?: string | null
          has_children?: boolean | null
          home_equity?: number | null
          home_ownership?: string | null
          home_purchased_years_ago?: number | null
          home_value?: number | null
          household_adults?: number | null
          household_income?: string | null
          household_income_midpoint?: number | null
          household_persons?: number | null
          id?: string
          income_level?: string | null
          interests?: Json | null
          investor_score?: number | null
          is_investor?: boolean | null
          is_primary_identity?: boolean | null
          is_veteran?: boolean | null
          language?: string | null
          last_enriched_at?: string | null
          last_name?: string | null
          latitude?: number | null
          lead_id?: string | null
          length_of_residence?: number | null
          likely_charitable_donor?: boolean | null
          linkedin_url?: string | null
          longitude?: number | null
          marital_status?: string | null
          median_home_value?: number | null
          median_income?: number | null
          mortgage_amount?: number | null
          mortgage_refinance_age?: number | null
          mortgage_refinance_amount?: number | null
          multilingual?: boolean | null
          net_worth?: string | null
          net_worth_midpoint?: number | null
          occupation?: string | null
          occupation_category?: string | null
          occupation_type?: string | null
          owns_investments?: boolean | null
          owns_mutual_funds?: boolean | null
          owns_stocks_bonds?: boolean | null
          owns_swimming_pool?: boolean | null
          political_contributor?: boolean | null
          premium_amex_card?: boolean | null
          premium_card?: boolean | null
          purchase_behavior?: Json | null
          raw_data?: Json
          reading_interests?: Json | null
          religion?: string | null
          retargetiq_id?: number | null
          single_family_dwelling?: boolean | null
          source?: string
          speaks_english?: boolean | null
          spouse_data?: Json | null
          state?: string | null
          urbanicity?: string | null
          vehicle_summary?: Json | null
          vehicles?: Json | null
          voter?: boolean | null
          white_collar?: boolean | null
          zip?: string | null
        }
        Update: {
          accredited_probability?: string | null
          address?: string | null
          affinities?: Json | null
          age?: number | null
          amex_card?: boolean | null
          bank_card?: boolean | null
          birth_date?: string | null
          birth_year?: number | null
          blue_collar?: boolean | null
          business_owner?: boolean | null
          city?: string | null
          client_id?: string
          companies?: Json | null
          company_name?: string | null
          company_title?: string | null
          confidence_score?: number | null
          congressional_district?: string | null
          county_name?: string | null
          created_at?: string
          credit_card?: boolean | null
          credit_midpoint?: number | null
          credit_range?: string | null
          discretionary_income?: string | null
          dma?: number | null
          donation_history?: Json | null
          dwelling_type?: string | null
          education?: string | null
          enriched_at?: string
          enriched_emails?: Json | null
          enriched_phones?: Json | null
          enrichment_match_count?: number | null
          enrichment_methods_used?: string[] | null
          enrichment_version?: number | null
          estimated_income?: number | null
          ethnicity?: string | null
          ethnicity_detail?: string | null
          external_id?: string
          financial_power?: number | null
          first_name?: string | null
          gender?: string | null
          generation?: string | null
          has_children?: boolean | null
          home_equity?: number | null
          home_ownership?: string | null
          home_purchased_years_ago?: number | null
          home_value?: number | null
          household_adults?: number | null
          household_income?: string | null
          household_income_midpoint?: number | null
          household_persons?: number | null
          id?: string
          income_level?: string | null
          interests?: Json | null
          investor_score?: number | null
          is_investor?: boolean | null
          is_primary_identity?: boolean | null
          is_veteran?: boolean | null
          language?: string | null
          last_enriched_at?: string | null
          last_name?: string | null
          latitude?: number | null
          lead_id?: string | null
          length_of_residence?: number | null
          likely_charitable_donor?: boolean | null
          linkedin_url?: string | null
          longitude?: number | null
          marital_status?: string | null
          median_home_value?: number | null
          median_income?: number | null
          mortgage_amount?: number | null
          mortgage_refinance_age?: number | null
          mortgage_refinance_amount?: number | null
          multilingual?: boolean | null
          net_worth?: string | null
          net_worth_midpoint?: number | null
          occupation?: string | null
          occupation_category?: string | null
          occupation_type?: string | null
          owns_investments?: boolean | null
          owns_mutual_funds?: boolean | null
          owns_stocks_bonds?: boolean | null
          owns_swimming_pool?: boolean | null
          political_contributor?: boolean | null
          premium_amex_card?: boolean | null
          premium_card?: boolean | null
          purchase_behavior?: Json | null
          raw_data?: Json
          reading_interests?: Json | null
          religion?: string | null
          retargetiq_id?: number | null
          single_family_dwelling?: boolean | null
          source?: string
          speaks_english?: boolean | null
          spouse_data?: Json | null
          state?: string | null
          urbanicity?: string | null
          vehicle_summary?: Json | null
          vehicles?: Json | null
          voter?: boolean | null
          white_collar?: boolean | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_enrichment_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "lead_enrichment_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_enrichment_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "lead_enrichment_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_enrichment_history: {
        Row: {
          changes: Json | null
          client_id: string
          created_at: string
          event_type: string
          external_id: string | null
          id: string
          lead_id: string | null
        }
        Insert: {
          changes?: Json | null
          client_id: string
          created_at?: string
          event_type: string
          external_id?: string | null
          id?: string
          lead_id?: string | null
        }
        Update: {
          changes?: Json | null
          client_id?: string
          created_at?: string
          event_type?: string
          external_id?: string | null
          id?: string
          lead_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_enrichment_history_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "lead_enrichment_history_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_enrichment_history_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      leads: {
        Row: {
          ad_id: string | null
          ad_set_name: string | null
          assigned_user: string | null
          campaign_name: string | null
          client_id: string
          created_at: string
          custom_fields: Json | null
          email: string | null
          external_id: string
          ghl_notes: Json | null
          ghl_synced_at: string | null
          id: string
          is_spam: boolean | null
          name: string | null
          opportunity_stage: string | null
          opportunity_stage_id: string | null
          opportunity_status: string | null
          opportunity_value: number | null
          phone: string | null
          pipeline_value: number | null
          questions: Json | null
          source: string
          status: string | null
          updated_at: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          ad_id?: string | null
          ad_set_name?: string | null
          assigned_user?: string | null
          campaign_name?: string | null
          client_id: string
          created_at?: string
          custom_fields?: Json | null
          email?: string | null
          external_id: string
          ghl_notes?: Json | null
          ghl_synced_at?: string | null
          id?: string
          is_spam?: boolean | null
          name?: string | null
          opportunity_stage?: string | null
          opportunity_stage_id?: string | null
          opportunity_status?: string | null
          opportunity_value?: number | null
          phone?: string | null
          pipeline_value?: number | null
          questions?: Json | null
          source?: string
          status?: string | null
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          ad_id?: string | null
          ad_set_name?: string | null
          assigned_user?: string | null
          campaign_name?: string | null
          client_id?: string
          created_at?: string
          custom_fields?: Json | null
          email?: string | null
          external_id?: string
          ghl_notes?: Json | null
          ghl_synced_at?: string | null
          id?: string
          is_spam?: boolean | null
          name?: string | null
          opportunity_stage?: string | null
          opportunity_stage_id?: string | null
          opportunity_status?: string | null
          opportunity_value?: number | null
          phone?: string | null
          pipeline_value?: number | null
          questions?: Json | null
          source?: string
          status?: string | null
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "leads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      member_activity_log: {
        Row: {
          action: string
          created_at: string | null
          details: Json | null
          entity_id: string | null
          entity_type: string | null
          id: string
          member_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          member_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          member_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_activity_log_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "agency_members"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_ad_accounts: {
        Row: {
          account_name: string | null
          ad_account_id: string
          assets_synced_at: string | null
          instagram_actors: Json | null
          last_seen_at: string
          pages: Json | null
          pixels: Json | null
          timezone_name: string
        }
        Insert: {
          account_name?: string | null
          ad_account_id: string
          assets_synced_at?: string | null
          instagram_actors?: Json | null
          last_seen_at?: string
          pages?: Json | null
          pixels?: Json | null
          timezone_name?: string
        }
        Update: {
          account_name?: string | null
          ad_account_id?: string
          assets_synced_at?: string | null
          instagram_actors?: Json | null
          last_seen_at?: string
          pages?: Json | null
          pixels?: Json | null
          timezone_name?: string
        }
        Relationships: []
      }
      meta_ad_sets: {
        Row: {
          attributed_calls: number | null
          attributed_funded: number | null
          attributed_funded_dollars: number | null
          attributed_leads: number | null
          attributed_showed: number | null
          attributed_spam_leads: number | null
          bid_strategy: string | null
          billing_event: string | null
          budget_remaining: number | null
          campaign_id: string | null
          clicks: number | null
          client_id: string
          cost_per_call: number | null
          cost_per_funded: number | null
          cost_per_lead: number | null
          cpc: number | null
          cpm: number | null
          created_at: string | null
          ctr: number | null
          daily_budget: number | null
          effective_status: string | null
          end_time: string | null
          frequency: number | null
          id: string
          impressions: number | null
          lifetime_budget: number | null
          meta_adset_id: string
          meta_campaign_id: string | null
          meta_reported_conversion_value: number | null
          meta_reported_conversions: number | null
          meta_reported_leads: number | null
          meta_reported_purchases: number | null
          name: string
          optimization_goal: string | null
          reach: number | null
          spend: number | null
          start_time: string | null
          status: string | null
          synced_at: string | null
          targeting: Json | null
          updated_at: string | null
        }
        Insert: {
          attributed_calls?: number | null
          attributed_funded?: number | null
          attributed_funded_dollars?: number | null
          attributed_leads?: number | null
          attributed_showed?: number | null
          attributed_spam_leads?: number | null
          bid_strategy?: string | null
          billing_event?: string | null
          budget_remaining?: number | null
          campaign_id?: string | null
          clicks?: number | null
          client_id: string
          cost_per_call?: number | null
          cost_per_funded?: number | null
          cost_per_lead?: number | null
          cpc?: number | null
          cpm?: number | null
          created_at?: string | null
          ctr?: number | null
          daily_budget?: number | null
          effective_status?: string | null
          end_time?: string | null
          frequency?: number | null
          id?: string
          impressions?: number | null
          lifetime_budget?: number | null
          meta_adset_id: string
          meta_campaign_id?: string | null
          meta_reported_conversion_value?: number | null
          meta_reported_conversions?: number | null
          meta_reported_leads?: number | null
          meta_reported_purchases?: number | null
          name: string
          optimization_goal?: string | null
          reach?: number | null
          spend?: number | null
          start_time?: string | null
          status?: string | null
          synced_at?: string | null
          targeting?: Json | null
          updated_at?: string | null
        }
        Update: {
          attributed_calls?: number | null
          attributed_funded?: number | null
          attributed_funded_dollars?: number | null
          attributed_leads?: number | null
          attributed_showed?: number | null
          attributed_spam_leads?: number | null
          bid_strategy?: string | null
          billing_event?: string | null
          budget_remaining?: number | null
          campaign_id?: string | null
          clicks?: number | null
          client_id?: string
          cost_per_call?: number | null
          cost_per_funded?: number | null
          cost_per_lead?: number | null
          cpc?: number | null
          cpm?: number | null
          created_at?: string | null
          ctr?: number | null
          daily_budget?: number | null
          effective_status?: string | null
          end_time?: string | null
          frequency?: number | null
          id?: string
          impressions?: number | null
          lifetime_budget?: number | null
          meta_adset_id?: string
          meta_campaign_id?: string | null
          meta_reported_conversion_value?: number | null
          meta_reported_conversions?: number | null
          meta_reported_leads?: number | null
          meta_reported_purchases?: number | null
          name?: string
          optimization_goal?: string | null
          reach?: number | null
          spend?: number | null
          start_time?: string | null
          status?: string | null
          synced_at?: string | null
          targeting?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_ad_sets_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "meta_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_ad_sets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "meta_ad_sets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_ad_sets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      meta_ads: {
        Row: {
          ad_set_id: string | null
          attributed_calls: number | null
          attributed_funded: number | null
          attributed_funded_dollars: number | null
          attributed_leads: number | null
          attributed_showed: number | null
          attributed_spam_leads: number | null
          body: string | null
          call_to_action_type: string | null
          clicks: number | null
          client_id: string
          conversions: number | null
          cost_per_call: number | null
          cost_per_conversion: number | null
          cost_per_funded: number | null
          cost_per_lead: number | null
          cpc: number | null
          cpm: number | null
          created_at: string | null
          creative_id: string | null
          ctr: number | null
          effective_status: string | null
          full_image_url: string | null
          headline: string | null
          id: string
          image_url: string | null
          impressions: number | null
          link_url: string | null
          media_type: string | null
          meta_ad_id: string
          meta_adset_id: string | null
          meta_campaign_id: string | null
          meta_reported_conversion_value: number | null
          meta_reported_conversions: number | null
          meta_reported_leads: number | null
          meta_reported_purchases: number | null
          name: string
          preview_url: string | null
          reach: number | null
          spend: number | null
          status: string | null
          synced_at: string | null
          thumbnail_url: string | null
          updated_at: string | null
          video_source_url: string | null
          video_thumbnail_url: string | null
        }
        Insert: {
          ad_set_id?: string | null
          attributed_calls?: number | null
          attributed_funded?: number | null
          attributed_funded_dollars?: number | null
          attributed_leads?: number | null
          attributed_showed?: number | null
          attributed_spam_leads?: number | null
          body?: string | null
          call_to_action_type?: string | null
          clicks?: number | null
          client_id: string
          conversions?: number | null
          cost_per_call?: number | null
          cost_per_conversion?: number | null
          cost_per_funded?: number | null
          cost_per_lead?: number | null
          cpc?: number | null
          cpm?: number | null
          created_at?: string | null
          creative_id?: string | null
          ctr?: number | null
          effective_status?: string | null
          full_image_url?: string | null
          headline?: string | null
          id?: string
          image_url?: string | null
          impressions?: number | null
          link_url?: string | null
          media_type?: string | null
          meta_ad_id: string
          meta_adset_id?: string | null
          meta_campaign_id?: string | null
          meta_reported_conversion_value?: number | null
          meta_reported_conversions?: number | null
          meta_reported_leads?: number | null
          meta_reported_purchases?: number | null
          name: string
          preview_url?: string | null
          reach?: number | null
          spend?: number | null
          status?: string | null
          synced_at?: string | null
          thumbnail_url?: string | null
          updated_at?: string | null
          video_source_url?: string | null
          video_thumbnail_url?: string | null
        }
        Update: {
          ad_set_id?: string | null
          attributed_calls?: number | null
          attributed_funded?: number | null
          attributed_funded_dollars?: number | null
          attributed_leads?: number | null
          attributed_showed?: number | null
          attributed_spam_leads?: number | null
          body?: string | null
          call_to_action_type?: string | null
          clicks?: number | null
          client_id?: string
          conversions?: number | null
          cost_per_call?: number | null
          cost_per_conversion?: number | null
          cost_per_funded?: number | null
          cost_per_lead?: number | null
          cpc?: number | null
          cpm?: number | null
          created_at?: string | null
          creative_id?: string | null
          ctr?: number | null
          effective_status?: string | null
          full_image_url?: string | null
          headline?: string | null
          id?: string
          image_url?: string | null
          impressions?: number | null
          link_url?: string | null
          media_type?: string | null
          meta_ad_id?: string
          meta_adset_id?: string | null
          meta_campaign_id?: string | null
          meta_reported_conversion_value?: number | null
          meta_reported_conversions?: number | null
          meta_reported_leads?: number | null
          meta_reported_purchases?: number | null
          name?: string
          preview_url?: string | null
          reach?: number | null
          spend?: number | null
          status?: string | null
          synced_at?: string | null
          thumbnail_url?: string | null
          updated_at?: string | null
          video_source_url?: string | null
          video_thumbnail_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_ads_ad_set_id_fkey"
            columns: ["ad_set_id"]
            isOneToOne: false
            referencedRelation: "meta_ad_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_ads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "meta_ads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_ads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      meta_ai_creative_insights: {
        Row: {
          body: string | null
          client_id: string | null
          confidence: number | null
          created_at: string
          evidence: Json | null
          generated_for_date: string | null
          id: string
          insight_type: string | null
          meta_ad_id: string | null
          model: string | null
          scope: string
          title: string | null
        }
        Insert: {
          body?: string | null
          client_id?: string | null
          confidence?: number | null
          created_at?: string
          evidence?: Json | null
          generated_for_date?: string | null
          id?: string
          insight_type?: string | null
          meta_ad_id?: string | null
          model?: string | null
          scope?: string
          title?: string | null
        }
        Update: {
          body?: string | null
          client_id?: string | null
          confidence?: number | null
          created_at?: string
          evidence?: Json | null
          generated_for_date?: string | null
          id?: string
          insight_type?: string | null
          meta_ad_id?: string | null
          model?: string | null
          scope?: string
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_ai_creative_insights_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "meta_ai_creative_insights_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_ai_creative_insights_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      meta_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          alert_type: string
          client_id: string | null
          created_at: string
          dispatched_channels: Json | null
          entity_id: string | null
          entity_type: string | null
          id: string
          message: string | null
          metadata: Json | null
          severity: string
          title: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_type: string
          client_id?: string | null
          created_at?: string
          dispatched_channels?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          message?: string | null
          metadata?: Json | null
          severity?: string
          title: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_type?: string
          client_id?: string | null
          created_at?: string
          dispatched_channels?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          message?: string | null
          metadata?: Json | null
          severity?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_alerts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "meta_alerts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_alerts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      meta_api_calls: {
        Row: {
          client_id: string | null
          created_at: string
          duration_ms: number | null
          endpoint: string
          error: string | null
          id: string
          params: Json | null
          response_summary: Json | null
          started_at: string
          status_code: number | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          duration_ms?: number | null
          endpoint: string
          error?: string | null
          id?: string
          params?: Json | null
          response_summary?: Json | null
          started_at?: string
          status_code?: number | null
        }
        Update: {
          client_id?: string | null
          created_at?: string
          duration_ms?: number | null
          endpoint?: string
          error?: string | null
          id?: string
          params?: Json | null
          response_summary?: Json | null
          started_at?: string
          status_code?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_api_calls_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "meta_api_calls_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_api_calls_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      meta_campaign_templates: {
        Row: {
          attribution_setting: string | null
          bid_strategy: string | null
          client_id: string | null
          config: Json | null
          created_at: string
          created_by: string | null
          daily_budget: number | null
          default_lead_form_id: string | null
          description: string | null
          exclusions: Json | null
          id: string
          lifetime_budget: number | null
          name: string
          naming_convention: Json | null
          objective: string | null
          optimization_goal: string | null
          placements: Json | null
          platform: string
          targeting: Json | null
          updated_at: string
          utm_template: Json | null
        }
        Insert: {
          attribution_setting?: string | null
          bid_strategy?: string | null
          client_id?: string | null
          config?: Json | null
          created_at?: string
          created_by?: string | null
          daily_budget?: number | null
          default_lead_form_id?: string | null
          description?: string | null
          exclusions?: Json | null
          id?: string
          lifetime_budget?: number | null
          name: string
          naming_convention?: Json | null
          objective?: string | null
          optimization_goal?: string | null
          placements?: Json | null
          platform?: string
          targeting?: Json | null
          updated_at?: string
          utm_template?: Json | null
        }
        Update: {
          attribution_setting?: string | null
          bid_strategy?: string | null
          client_id?: string | null
          config?: Json | null
          created_at?: string
          created_by?: string | null
          daily_budget?: number | null
          default_lead_form_id?: string | null
          description?: string | null
          exclusions?: Json | null
          id?: string
          lifetime_budget?: number | null
          name?: string
          naming_convention?: Json | null
          objective?: string | null
          optimization_goal?: string | null
          placements?: Json | null
          platform?: string
          targeting?: Json | null
          updated_at?: string
          utm_template?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_campaign_templates_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "meta_campaign_templates_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_campaign_templates_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      meta_campaigns: {
        Row: {
          attributed_calls: number | null
          attributed_funded: number | null
          attributed_funded_dollars: number | null
          attributed_leads: number | null
          attributed_showed: number | null
          attributed_spam_leads: number | null
          budget_remaining: number | null
          buying_type: string | null
          clicks: number | null
          client_id: string
          cost_per_call: number | null
          cost_per_funded: number | null
          cost_per_lead: number | null
          cpc: number | null
          cpm: number | null
          created_at: string | null
          created_time: string | null
          ctr: number | null
          daily_budget: number | null
          id: string
          impressions: number | null
          lifetime_budget: number | null
          meta_campaign_id: string
          meta_reported_conversion_value: number | null
          meta_reported_conversions: number | null
          meta_reported_leads: number | null
          meta_reported_purchases: number | null
          name: string
          objective: string | null
          spend: number | null
          start_time: string | null
          status: string | null
          stop_time: string | null
          synced_at: string | null
          updated_at: string | null
          updated_time: string | null
        }
        Insert: {
          attributed_calls?: number | null
          attributed_funded?: number | null
          attributed_funded_dollars?: number | null
          attributed_leads?: number | null
          attributed_showed?: number | null
          attributed_spam_leads?: number | null
          budget_remaining?: number | null
          buying_type?: string | null
          clicks?: number | null
          client_id: string
          cost_per_call?: number | null
          cost_per_funded?: number | null
          cost_per_lead?: number | null
          cpc?: number | null
          cpm?: number | null
          created_at?: string | null
          created_time?: string | null
          ctr?: number | null
          daily_budget?: number | null
          id?: string
          impressions?: number | null
          lifetime_budget?: number | null
          meta_campaign_id: string
          meta_reported_conversion_value?: number | null
          meta_reported_conversions?: number | null
          meta_reported_leads?: number | null
          meta_reported_purchases?: number | null
          name: string
          objective?: string | null
          spend?: number | null
          start_time?: string | null
          status?: string | null
          stop_time?: string | null
          synced_at?: string | null
          updated_at?: string | null
          updated_time?: string | null
        }
        Update: {
          attributed_calls?: number | null
          attributed_funded?: number | null
          attributed_funded_dollars?: number | null
          attributed_leads?: number | null
          attributed_showed?: number | null
          attributed_spam_leads?: number | null
          budget_remaining?: number | null
          buying_type?: string | null
          clicks?: number | null
          client_id?: string
          cost_per_call?: number | null
          cost_per_funded?: number | null
          cost_per_lead?: number | null
          cpc?: number | null
          cpm?: number | null
          created_at?: string | null
          created_time?: string | null
          ctr?: number | null
          daily_budget?: number | null
          id?: string
          impressions?: number | null
          lifetime_budget?: number | null
          meta_campaign_id?: string
          meta_reported_conversion_value?: number | null
          meta_reported_conversions?: number | null
          meta_reported_leads?: number | null
          meta_reported_purchases?: number | null
          name?: string
          objective?: string | null
          spend?: number | null
          start_time?: string | null
          status?: string | null
          stop_time?: string | null
          synced_at?: string | null
          updated_at?: string | null
          updated_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_campaigns_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "meta_campaigns_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_campaigns_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      meta_creative_comments: {
        Row: {
          approval_state: string | null
          author_id: string | null
          author_name: string | null
          body: string
          client_id: string | null
          created_at: string
          id: string
          meta_ad_id: string | null
          parent_id: string | null
          swipe_file_id: string | null
          updated_at: string
        }
        Insert: {
          approval_state?: string | null
          author_id?: string | null
          author_name?: string | null
          body: string
          client_id?: string | null
          created_at?: string
          id?: string
          meta_ad_id?: string | null
          parent_id?: string | null
          swipe_file_id?: string | null
          updated_at?: string
        }
        Update: {
          approval_state?: string | null
          author_id?: string | null
          author_name?: string | null
          body?: string
          client_id?: string | null
          created_at?: string
          id?: string
          meta_ad_id?: string | null
          parent_id?: string | null
          swipe_file_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_creative_comments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "meta_creative_comments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_creative_comments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "meta_creative_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "meta_creative_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_creative_comments_swipe_file_id_fkey"
            columns: ["swipe_file_id"]
            isOneToOne: false
            referencedRelation: "meta_swipe_files"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_creative_tags: {
        Row: {
          client_id: string | null
          computed_at: string
          created_at: string
          expires_at: string | null
          id: string
          meta_ad_id: string
          reasons: Json | null
          score: number | null
          source: string
          tag: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          computed_at?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          meta_ad_id: string
          reasons?: Json | null
          score?: number | null
          source?: string
          tag: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          computed_at?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          meta_ad_id?: string
          reasons?: Json | null
          score?: number | null
          source?: string
          tag?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_creative_tags_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "meta_creative_tags_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_creative_tags_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      meta_lead_form_mappings: {
        Row: {
          client_id: string | null
          created_at: string
          destination: string
          destination_config: Json | null
          field_mappings: Json | null
          id: string
          is_active: boolean | null
          meta_form_id: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          destination: string
          destination_config?: Json | null
          field_mappings?: Json | null
          id?: string
          is_active?: boolean | null
          meta_form_id: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          destination?: string
          destination_config?: Json | null
          field_mappings?: Json | null
          id?: string
          is_active?: boolean | null
          meta_form_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_lead_form_mappings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "meta_lead_form_mappings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_lead_form_mappings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      meta_lead_form_templates: {
        Row: {
          category: string | null
          client_id: string | null
          conditional_logic: Json | null
          config: Json | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_global: boolean | null
          name: string
          questions: Json | null
          updated_at: string
        }
        Insert: {
          category?: string | null
          client_id?: string | null
          conditional_logic?: Json | null
          config?: Json | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_global?: boolean | null
          name: string
          questions?: Json | null
          updated_at?: string
        }
        Update: {
          category?: string | null
          client_id?: string | null
          conditional_logic?: Json | null
          config?: Json | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_global?: boolean | null
          name?: string
          questions?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_lead_form_templates_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "meta_lead_form_templates_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_lead_form_templates_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      meta_lead_forms: {
        Row: {
          client_id: string | null
          completion_rate: number | null
          conditional_logic: Json | null
          conversion_rate: number | null
          cpl: number | null
          created_at: string
          id: string
          last_synced_at: string | null
          leads_count: number | null
          locale: string | null
          meta_ad_account_id: string | null
          meta_form_id: string
          meta_page_id: string | null
          name: string | null
          privacy_policy_url: string | null
          questions: Json | null
          raw: Json | null
          spend: number | null
          status: string | null
          thank_you_page: Json | null
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          completion_rate?: number | null
          conditional_logic?: Json | null
          conversion_rate?: number | null
          cpl?: number | null
          created_at?: string
          id?: string
          last_synced_at?: string | null
          leads_count?: number | null
          locale?: string | null
          meta_ad_account_id?: string | null
          meta_form_id: string
          meta_page_id?: string | null
          name?: string | null
          privacy_policy_url?: string | null
          questions?: Json | null
          raw?: Json | null
          spend?: number | null
          status?: string | null
          thank_you_page?: Json | null
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          completion_rate?: number | null
          conditional_logic?: Json | null
          conversion_rate?: number | null
          cpl?: number | null
          created_at?: string
          id?: string
          last_synced_at?: string | null
          leads_count?: number | null
          locale?: string | null
          meta_ad_account_id?: string | null
          meta_form_id?: string
          meta_page_id?: string | null
          name?: string | null
          privacy_policy_url?: string | null
          questions?: Json | null
          raw?: Json | null
          spend?: number | null
          status?: string | null
          thank_you_page?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_lead_forms_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "meta_lead_forms_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_lead_forms_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      meta_mcp_tool_calls: {
        Row: {
          arguments: Json
          client_id: string | null
          created_at: string
          duration_ms: number | null
          error: string | null
          id: string
          response: Json | null
          source: string
          success: boolean
          tool_name: string
          user_id: string | null
        }
        Insert: {
          arguments?: Json
          client_id?: string | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          response?: Json | null
          source?: string
          success?: boolean
          tool_name: string
          user_id?: string | null
        }
        Update: {
          arguments?: Json
          client_id?: string | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          response?: Json | null
          source?: string
          success?: boolean
          tool_name?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_mcp_tool_calls_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "meta_mcp_tool_calls_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_mcp_tool_calls_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      meta_rule_runs: {
        Row: {
          actions_taken: Json | null
          after_metrics: Json | null
          before_metrics: Json | null
          client_id: string | null
          error: string | null
          id: string
          matched_entities: Json | null
          ran_at: string
          rule_id: string
          status: string
        }
        Insert: {
          actions_taken?: Json | null
          after_metrics?: Json | null
          before_metrics?: Json | null
          client_id?: string | null
          error?: string | null
          id?: string
          matched_entities?: Json | null
          ran_at?: string
          rule_id: string
          status?: string
        }
        Update: {
          actions_taken?: Json | null
          after_metrics?: Json | null
          before_metrics?: Json | null
          client_id?: string | null
          error?: string | null
          id?: string
          matched_entities?: Json | null
          ran_at?: string
          rule_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_rule_runs_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "meta_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_rules: {
        Row: {
          action: string
          action_config: Json | null
          client_id: string | null
          conditions: Json
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          last_run_at: string | null
          name: string
          next_run_at: string | null
          notify_channels: Json | null
          platform: string
          schedule: string
          scope_ids: Json | null
          scope_level: string
          updated_at: string
        }
        Insert: {
          action: string
          action_config?: Json | null
          client_id?: string | null
          conditions?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          last_run_at?: string | null
          name: string
          next_run_at?: string | null
          notify_channels?: Json | null
          platform?: string
          schedule?: string
          scope_ids?: Json | null
          scope_level: string
          updated_at?: string
        }
        Update: {
          action?: string
          action_config?: Json | null
          client_id?: string | null
          conditions?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          last_run_at?: string | null
          name?: string
          next_run_at?: string | null
          notify_channels?: Json | null
          platform?: string
          schedule?: string
          scope_ids?: Json | null
          scope_level?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_rules_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "meta_rules_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_rules_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      meta_swipe_files: {
        Row: {
          ad_copy: string | null
          brand_name: string | null
          client_id: string | null
          created_at: string
          cta: string | null
          headline: string | null
          id: string
          media_type: string | null
          media_url: string | null
          notes: string | null
          raw: Json | null
          saved_by: string | null
          source: string
          source_url: string | null
          tags: Json | null
          updated_at: string
        }
        Insert: {
          ad_copy?: string | null
          brand_name?: string | null
          client_id?: string | null
          created_at?: string
          cta?: string | null
          headline?: string | null
          id?: string
          media_type?: string | null
          media_url?: string | null
          notes?: string | null
          raw?: Json | null
          saved_by?: string | null
          source?: string
          source_url?: string | null
          tags?: Json | null
          updated_at?: string
        }
        Update: {
          ad_copy?: string | null
          brand_name?: string | null
          client_id?: string | null
          created_at?: string
          cta?: string | null
          headline?: string | null
          id?: string
          media_type?: string | null
          media_url?: string | null
          notes?: string | null
          raw?: Json | null
          saved_by?: string | null
          source?: string
          source_url?: string | null
          tags?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_swipe_files_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "meta_swipe_files_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_swipe_files_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      meta_token_state: {
        Row: {
          access_token: string
          ad_account_count: number | null
          expires_at: string | null
          id: number
          last_error: string | null
          last_refreshed_at: string
          last_status: string | null
          last_validated_at: string | null
        }
        Insert: {
          access_token: string
          ad_account_count?: number | null
          expires_at?: string | null
          id?: number
          last_error?: string | null
          last_refreshed_at?: string
          last_status?: string | null
          last_validated_at?: string | null
        }
        Update: {
          access_token?: string
          ad_account_count?: number | null
          expires_at?: string | null
          id?: number
          last_error?: string | null
          last_refreshed_at?: string
          last_status?: string | null
          last_validated_at?: string | null
        }
        Relationships: []
      }
      meta_weekly_briefs: {
        Row: {
          client_id: string | null
          created_at: string
          doc_url: string | null
          fatigued: Json | null
          id: string
          new_concepts: Json | null
          notion_url: string | null
          pdf_url: string | null
          recommendations: Json | null
          status: string
          summary: string | null
          totals: Json | null
          updated_at: string
          week_end: string
          week_start: string
          winners: Json | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          doc_url?: string | null
          fatigued?: Json | null
          id?: string
          new_concepts?: Json | null
          notion_url?: string | null
          pdf_url?: string | null
          recommendations?: Json | null
          status?: string
          summary?: string | null
          totals?: Json | null
          updated_at?: string
          week_end: string
          week_start: string
          winners?: Json | null
        }
        Update: {
          client_id?: string | null
          created_at?: string
          doc_url?: string | null
          fatigued?: Json | null
          id?: string
          new_concepts?: Json | null
          notion_url?: string | null
          pdf_url?: string | null
          recommendations?: Json | null
          status?: string
          summary?: string | null
          totals?: Json | null
          updated_at?: string
          week_end?: string
          week_start?: string
          winners?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_weekly_briefs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "meta_weekly_briefs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_weekly_briefs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      monitoring_status: {
        Row: {
          ads_found: number | null
          error_message: string | null
          id: string
          last_checked_at: string | null
          status: string | null
          target_id: string | null
          updated_at: string | null
        }
        Insert: {
          ads_found?: number | null
          error_message?: string | null
          id?: string
          last_checked_at?: string | null
          status?: string | null
          target_id?: string | null
          updated_at?: string | null
        }
        Update: {
          ads_found?: number | null
          error_message?: string | null
          id?: string
          last_checked_at?: string | null
          status?: string | null
          target_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "monitoring_status_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "monitoring_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      monitoring_targets: {
        Row: {
          advertiser_name: string
          client_id: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          last_scraped_at: string | null
          page_id: string | null
          platform: string | null
          type: string | null
          value: string | null
        }
        Insert: {
          advertiser_name: string
          client_id?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_scraped_at?: string | null
          page_id?: string | null
          platform?: string | null
          type?: string | null
          value?: string | null
        }
        Update: {
          advertiser_name?: string
          client_id?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_scraped_at?: string | null
          page_id?: string | null
          platform?: string | null
          type?: string | null
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "monitoring_targets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "monitoring_targets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monitoring_targets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      onboarding_notifications: {
        Row: {
          channel: string
          client_id: string | null
          created_at: string
          id: string
          message: string
          metadata: Json | null
          phase: string | null
          recipient: string | null
          status: string
        }
        Insert: {
          channel: string
          client_id?: string | null
          created_at?: string
          id?: string
          message: string
          metadata?: Json | null
          phase?: string | null
          recipient?: string | null
          status?: string
        }
        Update: {
          channel?: string
          client_id?: string | null
          created_at?: string
          id?: string
          message?: string
          metadata?: Json | null
          phase?: string | null
          recipient?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_notifications_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "onboarding_notifications_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_notifications_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      onboarding_template_items: {
        Row: {
          category: string
          created_at: string
          id: string
          parent_title: string | null
          sort_order: number
          template_key: string
          title: string
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          parent_title?: string | null
          sort_order?: number
          template_key: string
          title: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          parent_title?: string | null
          sort_order?: number
          template_key?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      pagespeed_cache: {
        Row: {
          fetched_at: string
          id: string
          metrics: Json | null
          performance_score: number | null
          step_id: string
          strategy: string
          url: string
        }
        Insert: {
          fetched_at?: string
          id?: string
          metrics?: Json | null
          performance_score?: number | null
          step_id: string
          strategy?: string
          url: string
        }
        Update: {
          fetched_at?: string
          id?: string
          metrics?: Json | null
          performance_score?: number | null
          step_id?: string
          strategy?: string
          url?: string
        }
        Relationships: []
      }
      pending_meeting_tasks: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          client_id: string | null
          created_at: string
          description: string | null
          id: string
          meeting_id: string | null
          priority: string
          status: string
          task_id: string | null
          title: string
          voice_note_id: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          client_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          meeting_id?: string | null
          priority?: string
          status?: string
          task_id?: string | null
          title: string
          voice_note_id?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          client_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          meeting_id?: string | null
          priority?: string
          status?: string
          task_id?: string | null
          title?: string
          voice_note_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pending_meeting_tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "pending_meeting_tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_meeting_tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "pending_meeting_tasks_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "agency_meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_meeting_tasks_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_meeting_tasks_voice_note_id_fkey"
            columns: ["voice_note_id"]
            isOneToOne: false
            referencedRelation: "client_voice_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_opportunities: {
        Row: {
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          ghl_contact_id: string | null
          ghl_opportunity_id: string
          id: string
          last_stage_change_at: string | null
          monetary_value: number | null
          pipeline_id: string
          source: string | null
          stage_id: string
          status: string | null
          updated_at: string
        }
        Insert: {
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          ghl_contact_id?: string | null
          ghl_opportunity_id: string
          id?: string
          last_stage_change_at?: string | null
          monetary_value?: number | null
          pipeline_id: string
          source?: string | null
          stage_id: string
          status?: string | null
          updated_at?: string
        }
        Update: {
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          ghl_contact_id?: string | null
          ghl_opportunity_id?: string
          id?: string
          last_stage_change_at?: string | null
          monetary_value?: number | null
          pipeline_id?: string
          source?: string | null
          stage_id?: string
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_opportunities_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "client_pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_opportunities_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_stages: {
        Row: {
          created_at: string
          ghl_stage_id: string
          id: string
          name: string
          pipeline_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          ghl_stage_id: string
          id?: string
          name: string
          pipeline_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          ghl_stage_id?: string
          id?: string
          name?: string
          pipeline_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stages_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "client_pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      pixel_expected_events: {
        Row: {
          created_at: string
          event_name: string
          id: string
          is_custom: boolean
          platform: string
          step_id: string
        }
        Insert: {
          created_at?: string
          event_name: string
          id?: string
          is_custom?: boolean
          platform: string
          step_id: string
        }
        Update: {
          created_at?: string
          event_name?: string
          id?: string
          is_custom?: boolean
          platform?: string
          step_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pixel_expected_events_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "client_funnel_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      pixel_verifications: {
        Row: {
          client_id: string
          created_at: string
          events_detected: string[] | null
          id: string
          missing_expected: string[] | null
          results: Json
          scanned_at: string
          status: string
          step_id: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          events_detected?: string[] | null
          id?: string
          missing_expected?: string[] | null
          results?: Json
          scanned_at?: string
          status?: string
          step_id?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          events_detected?: string[] | null
          id?: string
          missing_expected?: string[] | null
          results?: Json
          scanned_at?: string
          status?: string
          step_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pixel_verifications_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "pixel_verifications_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pixel_verifications_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "pixel_verifications_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "client_funnel_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          client_id: string | null
          created_at: string | null
          description: string | null
          id: string
          name: string
          offer_description: string | null
          settings: Json
          type: string
          updated_at: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          offer_description?: string | null
          settings?: Json
          type?: string
          updated_at?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          offer_description?: string | null
          settings?: Json
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      quiz_questions: {
        Row: {
          created_at: string | null
          disqualify_if: Json | null
          funnel_id: string | null
          id: string
          options: Json | null
          question: string
          question_type: string
          required: boolean | null
          sort_order: number | null
        }
        Insert: {
          created_at?: string | null
          disqualify_if?: Json | null
          funnel_id?: string | null
          id?: string
          options?: Json | null
          question: string
          question_type?: string
          required?: boolean | null
          sort_order?: number | null
        }
        Update: {
          created_at?: string | null
          disqualify_if?: Json | null
          funnel_id?: string | null
          id?: string
          options?: Json | null
          question?: string
          question_type?: string
          required?: boolean | null
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "quiz_questions_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_responses: {
        Row: {
          created_at: string | null
          funnel_id: string | null
          id: string
          lead_id: string | null
          qualified: boolean | null
          responses: Json | null
          session_id: string | null
        }
        Insert: {
          created_at?: string | null
          funnel_id?: string | null
          id?: string
          lead_id?: string | null
          qualified?: boolean | null
          responses?: Json | null
          session_id?: string | null
        }
        Update: {
          created_at?: string | null
          funnel_id?: string | null
          id?: string
          lead_id?: string | null
          qualified?: boolean | null
          responses?: Json | null
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quiz_responses_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quiz_responses_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_items: {
        Row: {
          client_id: string
          created_at: string
          dashboard_value: number | null
          delta: number | null
          delta_percent: number | null
          id: string
          is_mismatch: boolean
          metric_name: string
          notes: string | null
          run_id: string
          source_name: string
          source_value: number | null
          threshold_percent: number
        }
        Insert: {
          client_id: string
          created_at?: string
          dashboard_value?: number | null
          delta?: number | null
          delta_percent?: number | null
          id?: string
          is_mismatch?: boolean
          metric_name: string
          notes?: string | null
          run_id: string
          source_name: string
          source_value?: number | null
          threshold_percent?: number
        }
        Update: {
          client_id?: string
          created_at?: string
          dashboard_value?: number | null
          delta?: number | null
          delta_percent?: number | null
          id?: string
          is_mismatch?: boolean
          metric_name?: string
          notes?: string | null
          run_id?: string
          source_name?: string
          source_value?: number | null
          threshold_percent?: number
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "reconciliation_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "reconciliation_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "reconciliation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_runs: {
        Row: {
          created_at: string
          finished_at: string | null
          id: string
          mismatches_found: number
          run_date: string
          started_at: string | null
          status: string
          total_checks: number
        }
        Insert: {
          created_at?: string
          finished_at?: string | null
          id?: string
          mismatches_found?: number
          run_date?: string
          started_at?: string | null
          status?: string
          total_checks?: number
        }
        Update: {
          created_at?: string
          finished_at?: string | null
          id?: string
          mismatches_found?: number
          run_date?: string
          started_at?: string | null
          status?: string
          total_checks?: number
        }
        Relationships: []
      }
      scraped_ads: {
        Row: {
          ad_count: number | null
          ad_format: string | null
          ad_id: string | null
          advertiser_name: string | null
          body: string | null
          category: string | null
          client_id: string | null
          company: string | null
          created_at: string | null
          description: string | null
          end_date: string | null
          headline: string | null
          id: string
          image_url: string | null
          impressions_range: string | null
          is_swipe_file: boolean | null
          iterated: boolean | null
          metadata: Json | null
          monitoring_target_id: string | null
          platform: string | null
          reach: number | null
          saves: number | null
          scraped_at: string | null
          selected: boolean | null
          source: string
          source_url: string | null
          spend_range: string | null
          start_date: string | null
          status: string | null
          tags: string[] | null
          video_url: string | null
          views: number | null
        }
        Insert: {
          ad_count?: number | null
          ad_format?: string | null
          ad_id?: string | null
          advertiser_name?: string | null
          body?: string | null
          category?: string | null
          client_id?: string | null
          company?: string | null
          created_at?: string | null
          description?: string | null
          end_date?: string | null
          headline?: string | null
          id?: string
          image_url?: string | null
          impressions_range?: string | null
          is_swipe_file?: boolean | null
          iterated?: boolean | null
          metadata?: Json | null
          monitoring_target_id?: string | null
          platform?: string | null
          reach?: number | null
          saves?: number | null
          scraped_at?: string | null
          selected?: boolean | null
          source?: string
          source_url?: string | null
          spend_range?: string | null
          start_date?: string | null
          status?: string | null
          tags?: string[] | null
          video_url?: string | null
          views?: number | null
        }
        Update: {
          ad_count?: number | null
          ad_format?: string | null
          ad_id?: string | null
          advertiser_name?: string | null
          body?: string | null
          category?: string | null
          client_id?: string | null
          company?: string | null
          created_at?: string | null
          description?: string | null
          end_date?: string | null
          headline?: string | null
          id?: string
          image_url?: string | null
          impressions_range?: string | null
          is_swipe_file?: boolean | null
          iterated?: boolean | null
          metadata?: Json | null
          monitoring_target_id?: string | null
          platform?: string | null
          reach?: number | null
          saves?: number | null
          scraped_at?: string | null
          selected?: boolean | null
          source?: string
          source_url?: string | null
          spend_range?: string | null
          start_date?: string | null
          status?: string | null
          tags?: string[] | null
          video_url?: string | null
          views?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "scraped_ads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "scraped_ads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scraped_ads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "scraped_ads_monitoring_target_id_fkey"
            columns: ["monitoring_target_id"]
            isOneToOne: false
            referencedRelation: "monitoring_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      scraping_schedule: {
        Row: {
          client_id: string | null
          client_ids: string[] | null
          competitor_handles: string[] | null
          created_at: string | null
          enabled: boolean | null
          id: string
          is_active: boolean | null
          keywords: string[] | null
          last_run_at: string | null
          next_run_at: string | null
          platforms: string[] | null
          schedule_type: string
          scrape_time: string | null
          viral_hashtags: string[] | null
        }
        Insert: {
          client_id?: string | null
          client_ids?: string[] | null
          competitor_handles?: string[] | null
          created_at?: string | null
          enabled?: boolean | null
          id?: string
          is_active?: boolean | null
          keywords?: string[] | null
          last_run_at?: string | null
          next_run_at?: string | null
          platforms?: string[] | null
          schedule_type?: string
          scrape_time?: string | null
          viral_hashtags?: string[] | null
        }
        Update: {
          client_id?: string | null
          client_ids?: string[] | null
          competitor_handles?: string[] | null
          created_at?: string | null
          enabled?: boolean | null
          id?: string
          is_active?: boolean | null
          keywords?: string[] | null
          last_run_at?: string | null
          next_run_at?: string | null
          platforms?: string[] | null
          schedule_type?: string
          scrape_time?: string | null
          viral_hashtags?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "scraping_schedule_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "scraping_schedule_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scraping_schedule_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      scripts: {
        Row: {
          content: string
          created_at: string
          duration_seconds: number | null
          framework: string | null
          hook: string | null
          id: string
          project_id: string
          selected: boolean
          title: string
        }
        Insert: {
          content?: string
          created_at?: string
          duration_seconds?: number | null
          framework?: string | null
          hook?: string | null
          id?: string
          project_id: string
          selected?: boolean
          title?: string
        }
        Update: {
          content?: string
          created_at?: string
          duration_seconds?: number | null
          framework?: string | null
          hook?: string | null
          id?: string
          project_id?: string
          selected?: boolean
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "scripts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      sheet_audit_runs: {
        Row: {
          accuracy_delta_count: number
          client_id: string | null
          created_at: string
          findings: Json
          id: string
          quality_issue_count: number
          quality_score: number | null
          run_at: string
          scope: string
          sheet_url: string | null
          spam_count: number
          summary: string | null
          tab_gid: string | null
          triggered_by: string | null
          whatsapp_message: string | null
        }
        Insert: {
          accuracy_delta_count?: number
          client_id?: string | null
          created_at?: string
          findings?: Json
          id?: string
          quality_issue_count?: number
          quality_score?: number | null
          run_at?: string
          scope?: string
          sheet_url?: string | null
          spam_count?: number
          summary?: string | null
          tab_gid?: string | null
          triggered_by?: string | null
          whatsapp_message?: string | null
        }
        Update: {
          accuracy_delta_count?: number
          client_id?: string | null
          created_at?: string
          findings?: Json
          id?: string
          quality_issue_count?: number
          quality_score?: number | null
          run_at?: string
          scope?: string
          sheet_url?: string | null
          spam_count?: number
          summary?: string | null
          tab_gid?: string | null
          triggered_by?: string | null
          whatsapp_message?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sheet_audit_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "sheet_audit_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sheet_audit_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      slack_activity_log: {
        Row: {
          action_type: string | null
          channel_id: string | null
          channel_name: string | null
          client_id: string | null
          created_at: string
          id: string
          message_text: string | null
          message_ts: string | null
          metadata: Json | null
          task_id: string | null
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          action_type?: string | null
          channel_id?: string | null
          channel_name?: string | null
          client_id?: string | null
          created_at?: string
          id?: string
          message_text?: string | null
          message_ts?: string | null
          metadata?: Json | null
          task_id?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          action_type?: string | null
          channel_id?: string | null
          channel_name?: string | null
          client_id?: string | null
          created_at?: string
          id?: string
          message_text?: string | null
          message_ts?: string | null
          metadata?: Json | null
          task_id?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "slack_activity_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "slack_activity_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slack_activity_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      slack_channel_mappings: {
        Row: {
          auto_create_tasks: boolean
          channel_id: string
          channel_name: string | null
          channel_type: string
          client_id: string
          created_at: string
          id: string
          monitor_messages: boolean
          updated_at: string
        }
        Insert: {
          auto_create_tasks?: boolean
          channel_id: string
          channel_name?: string | null
          channel_type?: string
          client_id: string
          created_at?: string
          id?: string
          monitor_messages?: boolean
          updated_at?: string
        }
        Update: {
          auto_create_tasks?: boolean
          channel_id?: string
          channel_name?: string | null
          channel_type?: string
          client_id?: string
          created_at?: string
          id?: string
          monitor_messages?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "slack_channel_mappings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "slack_channel_mappings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slack_channel_mappings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      spam_blacklist: {
        Row: {
          created_at: string
          id: string
          ip_address: string | null
          reason: string | null
          type: string
          value: string
        }
        Insert: {
          created_at?: string
          id?: string
          ip_address?: string | null
          reason?: string | null
          type?: string
          value: string
        }
        Update: {
          created_at?: string
          id?: string
          ip_address?: string | null
          reason?: string | null
          type?: string
          value?: string
        }
        Relationships: []
      }
      swipe_file: {
        Row: {
          added_by: string | null
          category: string | null
          client_id: string | null
          created_at: string | null
          id: string
          image_url: string | null
          notes: string | null
          scraped_ad_id: string | null
          tags: string[] | null
          title: string
          video_url: string | null
        }
        Insert: {
          added_by?: string | null
          category?: string | null
          client_id?: string | null
          created_at?: string | null
          id?: string
          image_url?: string | null
          notes?: string | null
          scraped_ad_id?: string | null
          tags?: string[] | null
          title: string
          video_url?: string | null
        }
        Update: {
          added_by?: string | null
          category?: string | null
          client_id?: string | null
          created_at?: string | null
          id?: string
          image_url?: string | null
          notes?: string | null
          scraped_ad_id?: string | null
          tags?: string[] | null
          title?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "swipe_file_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "swipe_file_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swipe_file_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "swipe_file_scraped_ad_id_fkey"
            columns: ["scraped_ad_id"]
            isOneToOne: false
            referencedRelation: "scraped_ads"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_accuracy_log: {
        Row: {
          actual_count: number
          auto_fixed: boolean
          check_date: string
          client_id: string
          created_at: string
          discrepancy: number
          expected_count: number
          id: string
          metric_type: string
        }
        Insert: {
          actual_count?: number
          auto_fixed?: boolean
          check_date: string
          client_id: string
          created_at?: string
          discrepancy?: number
          expected_count?: number
          id?: string
          metric_type: string
        }
        Update: {
          actual_count?: number
          auto_fixed?: boolean
          check_date?: string
          client_id?: string
          created_at?: string
          discrepancy?: number
          expected_count?: number
          id?: string
          metric_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_accuracy_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "sync_accuracy_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_accuracy_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      sync_errors: {
        Row: {
          attempt_number: number
          client_id: string | null
          created_at: string
          endpoint: string | null
          error_message: string | null
          id: string
          integration_name: string
          status_code: number | null
        }
        Insert: {
          attempt_number?: number
          client_id?: string | null
          created_at?: string
          endpoint?: string | null
          error_message?: string | null
          id?: string
          integration_name: string
          status_code?: number | null
        }
        Update: {
          attempt_number?: number
          client_id?: string | null
          created_at?: string
          endpoint?: string | null
          error_message?: string | null
          id?: string
          integration_name?: string
          status_code?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sync_errors_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "sync_errors_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_errors_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      sync_health_snapshots: {
        Row: {
          client_id: string
          db_lead_count: number | null
          delta_pct: number | null
          details: Json | null
          id: string
          last_cursor_sync_at: string | null
          last_master_sync_at: string | null
          last_webhook_at: string | null
          queue_dead_letter: number
          queue_failed: number
          queue_pending: number
          queue_processing: number
          snapshot_at: string
          source_lead_count: number | null
          success_rate_24h: number | null
        }
        Insert: {
          client_id: string
          db_lead_count?: number | null
          delta_pct?: number | null
          details?: Json | null
          id?: string
          last_cursor_sync_at?: string | null
          last_master_sync_at?: string | null
          last_webhook_at?: string | null
          queue_dead_letter?: number
          queue_failed?: number
          queue_pending?: number
          queue_processing?: number
          snapshot_at?: string
          source_lead_count?: number | null
          success_rate_24h?: number | null
        }
        Update: {
          client_id?: string
          db_lead_count?: number | null
          delta_pct?: number | null
          details?: Json | null
          id?: string
          last_cursor_sync_at?: string | null
          last_master_sync_at?: string | null
          last_webhook_at?: string | null
          queue_dead_letter?: number
          queue_failed?: number
          queue_pending?: number
          queue_processing?: number
          snapshot_at?: string
          source_lead_count?: number | null
          success_rate_24h?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sync_health_snapshots_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "sync_health_snapshots_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_health_snapshots_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      sync_logs: {
        Row: {
          client_id: string
          completed_at: string | null
          error_message: string | null
          id: string
          records_synced: number | null
          started_at: string
          status: string
          sync_type: string
        }
        Insert: {
          client_id: string
          completed_at?: string | null
          error_message?: string | null
          id?: string
          records_synced?: number | null
          started_at?: string
          status?: string
          sync_type: string
        }
        Update: {
          client_id?: string
          completed_at?: string | null
          error_message?: string | null
          id?: string
          records_synced?: number | null
          started_at?: string
          status?: string
          sync_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "sync_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      sync_outbound_events: {
        Row: {
          channel: string
          client_id: string
          contact_identifier: string
          created_at: string
          direction: string
          event_at: string
          external_id: string
          ghl_contact_id: string | null
          id: string
          payload: Json
          retry_count: number
          sync_error: string | null
          synced_at: string | null
          synced_to_ghl: boolean
        }
        Insert: {
          channel: string
          client_id: string
          contact_identifier: string
          created_at?: string
          direction: string
          event_at?: string
          external_id: string
          ghl_contact_id?: string | null
          id?: string
          payload?: Json
          retry_count?: number
          sync_error?: string | null
          synced_at?: string | null
          synced_to_ghl?: boolean
        }
        Update: {
          channel?: string
          client_id?: string
          contact_identifier?: string
          created_at?: string
          direction?: string
          event_at?: string
          external_id?: string
          ghl_contact_id?: string | null
          id?: string
          payload?: Json
          retry_count?: number
          sync_error?: string | null
          synced_at?: string | null
          synced_to_ghl?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "sync_outbound_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "sync_outbound_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_outbound_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      sync_queue: {
        Row: {
          attempts: number
          batch_number: number | null
          client_id: string
          completed_at: string | null
          created_at: string | null
          date_range_end: string | null
          date_range_start: string | null
          dead_letter: boolean
          error_message: string | null
          external_id: string | null
          id: string
          idempotency_key: string | null
          last_attempted_at: string | null
          max_attempts: number
          next_retry_at: string | null
          payload: Json | null
          priority: number | null
          provider: string | null
          records_processed: number | null
          source: string | null
          started_at: string | null
          status: string | null
          sync_type: string
          total_batches: number | null
        }
        Insert: {
          attempts?: number
          batch_number?: number | null
          client_id: string
          completed_at?: string | null
          created_at?: string | null
          date_range_end?: string | null
          date_range_start?: string | null
          dead_letter?: boolean
          error_message?: string | null
          external_id?: string | null
          id?: string
          idempotency_key?: string | null
          last_attempted_at?: string | null
          max_attempts?: number
          next_retry_at?: string | null
          payload?: Json | null
          priority?: number | null
          provider?: string | null
          records_processed?: number | null
          source?: string | null
          started_at?: string | null
          status?: string | null
          sync_type: string
          total_batches?: number | null
        }
        Update: {
          attempts?: number
          batch_number?: number | null
          client_id?: string
          completed_at?: string | null
          created_at?: string | null
          date_range_end?: string | null
          date_range_start?: string | null
          dead_letter?: boolean
          error_message?: string | null
          external_id?: string | null
          id?: string
          idempotency_key?: string | null
          last_attempted_at?: string | null
          max_attempts?: number
          next_retry_at?: string | null
          payload?: Json | null
          priority?: number | null
          provider?: string | null
          records_processed?: number | null
          source?: string | null
          started_at?: string | null
          status?: string | null
          sync_type?: string
          total_batches?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sync_queue_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "sync_queue_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_queue_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      sync_runs: {
        Row: {
          client_id: string | null
          error_message: string | null
          finished_at: string | null
          function_name: string
          id: string
          metadata: Json | null
          rows_written: number | null
          source: string | null
          started_at: string
          status: string
        }
        Insert: {
          client_id?: string | null
          error_message?: string | null
          finished_at?: string | null
          function_name: string
          id?: string
          metadata?: Json | null
          rows_written?: number | null
          source?: string | null
          started_at?: string
          status?: string
        }
        Update: {
          client_id?: string | null
          error_message?: string | null
          finished_at?: string | null
          function_name?: string
          id?: string
          metadata?: Json | null
          rows_written?: number | null
          source?: string | null
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "sync_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      sync_warnings: {
        Row: {
          client_id: string
          created_at: string
          id: string
          message: string
          metadata: Json | null
          warning_type: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          message: string
          metadata?: Json | null
          warning_type: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          message?: string
          metadata?: Json | null
          warning_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_warnings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "sync_warnings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_warnings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      task_assignees: {
        Row: {
          created_at: string
          id: string
          member_id: string | null
          pod_id: string | null
          task_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          member_id?: string | null
          pod_id?: string | null
          task_id: string
        }
        Update: {
          created_at?: string
          id?: string
          member_id?: string | null
          pod_id?: string | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_assignees_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "agency_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignees_pod_id_fkey"
            columns: ["pod_id"]
            isOneToOne: false
            referencedRelation: "agency_pods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignees_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_comments: {
        Row: {
          audio_url: string | null
          author_name: string
          comment_type: string | null
          content: string
          created_at: string
          duration_seconds: number | null
          id: string
          task_id: string
          transcript: string | null
        }
        Insert: {
          audio_url?: string | null
          author_name: string
          comment_type?: string | null
          content: string
          created_at?: string
          duration_seconds?: number | null
          id?: string
          task_id: string
          transcript?: string | null
        }
        Update: {
          audio_url?: string | null
          author_name?: string
          comment_type?: string | null
          content?: string
          created_at?: string
          duration_seconds?: number | null
          id?: string
          task_id?: string
          transcript?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_files: {
        Row: {
          created_at: string
          file_name: string
          file_type: string | null
          file_url: string
          id: string
          task_id: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          file_name: string
          file_type?: string | null
          file_url: string
          id?: string
          task_id: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          file_name?: string
          file_type?: string | null
          file_url?: string
          id?: string
          task_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_files_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_history: {
        Row: {
          action: string
          changed_by: string | null
          created_at: string
          id: string
          new_value: string | null
          old_value: string | null
          task_id: string
        }
        Insert: {
          action: string
          changed_by?: string | null
          created_at?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          task_id: string
        }
        Update: {
          action?: string
          changed_by?: string | null
          created_at?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_history_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          member_id: string
          message: string
          task_id: string | null
          triggered_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          member_id: string
          message: string
          task_id?: string | null
          triggered_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          member_id?: string
          message?: string
          task_id?: string | null
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_notifications_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "agency_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_notifications_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assigned_client_name: string | null
          assigned_to: string | null
          category: string | null
          client_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          id: string
          meeting_id: string | null
          parent_task_id: string | null
          priority: string
          project_id: string | null
          recurrence_interval: number | null
          recurrence_next_at: string | null
          recurrence_parent_id: string | null
          recurrence_type: string | null
          show_subtasks_to_client: boolean | null
          sort_order: number | null
          stage: string
          status: string
          title: string
          updated_at: string
          visible_to_client: boolean
        }
        Insert: {
          assigned_client_name?: string | null
          assigned_to?: string | null
          category?: string | null
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          meeting_id?: string | null
          parent_task_id?: string | null
          priority?: string
          project_id?: string | null
          recurrence_interval?: number | null
          recurrence_next_at?: string | null
          recurrence_parent_id?: string | null
          recurrence_type?: string | null
          show_subtasks_to_client?: boolean | null
          sort_order?: number | null
          stage?: string
          status?: string
          title: string
          updated_at?: string
          visible_to_client?: boolean
        }
        Update: {
          assigned_client_name?: string | null
          assigned_to?: string | null
          category?: string | null
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          meeting_id?: string | null
          parent_task_id?: string | null
          priority?: string
          project_id?: string | null
          recurrence_interval?: number | null
          recurrence_next_at?: string | null
          recurrence_parent_id?: string | null
          recurrence_type?: string | null
          show_subtasks_to_client?: boolean | null
          sort_order?: number | null
          stage?: string
          status?: string
          title?: string
          updated_at?: string
          visible_to_client?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "agency_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "tasks_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "agency_meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_recurrence_parent_id_fkey"
            columns: ["recurrence_parent_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      top_performer_uploads: {
        Row: {
          client_id: string | null
          created_at: string
          file_type: string
          file_url: string
          id: string
          mime_type: string | null
          name: string
          notes: string | null
          size_bytes: number | null
          storage_path: string | null
          thumbnail_url: string | null
          transcript: string | null
          transcription_status: string | null
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          file_type?: string
          file_url: string
          id?: string
          mime_type?: string | null
          name: string
          notes?: string | null
          size_bytes?: number | null
          storage_path?: string | null
          thumbnail_url?: string | null
          transcript?: string | null
          transcription_status?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          file_type?: string
          file_url?: string
          id?: string
          mime_type?: string | null
          name?: string
          notes?: string | null
          size_bytes?: number | null
          storage_path?: string | null
          thumbnail_url?: string | null
          transcript?: string | null
          transcription_status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "top_performer_uploads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "top_performer_uploads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "top_performer_uploads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      video_batch_jobs: {
        Row: {
          aspect_ratio: string
          character_description: string | null
          client_id: string | null
          completed_scenes: number
          created_at: string
          default_duration: number
          error: string | null
          failed_scenes: number
          id: string
          model: string
          offer_description: string | null
          resolution: string
          status: string
          total_scenes: number
          updated_at: string
          user_id: string
        }
        Insert: {
          aspect_ratio?: string
          character_description?: string | null
          client_id?: string | null
          completed_scenes?: number
          created_at?: string
          default_duration?: number
          error?: string | null
          failed_scenes?: number
          id?: string
          model: string
          offer_description?: string | null
          resolution?: string
          status?: string
          total_scenes?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          aspect_ratio?: string
          character_description?: string | null
          client_id?: string | null
          completed_scenes?: number
          created_at?: string
          default_duration?: number
          error?: string | null
          failed_scenes?: number
          id?: string
          model?: string
          offer_description?: string | null
          resolution?: string
          status?: string
          total_scenes?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      video_batch_scenes: {
        Row: {
          asset_id: string | null
          batch_id: string
          created_at: string
          duration: number
          error: string | null
          id: string
          poll_attempts: number
          polling_url: string | null
          prompt: string
          provider_job_id: string | null
          raw_video_url: string | null
          scene_order: number
          script_id: string
          status: string
          stored_video_url: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          asset_id?: string | null
          batch_id: string
          created_at?: string
          duration: number
          error?: string | null
          id?: string
          poll_attempts?: number
          polling_url?: string | null
          prompt: string
          provider_job_id?: string | null
          raw_video_url?: string | null
          scene_order: number
          script_id: string
          status?: string
          stored_video_url?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          asset_id?: string | null
          batch_id?: string
          created_at?: string
          duration?: number
          error?: string | null
          id?: string
          poll_attempts?: number
          polling_url?: string | null
          prompt?: string
          provider_job_id?: string | null
          raw_video_url?: string | null
          scene_order?: number
          script_id?: string
          status?: string
          stored_video_url?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_batch_scenes_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "video_batch_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_batch_scenes_script_id_fkey"
            columns: ["script_id"]
            isOneToOne: false
            referencedRelation: "video_batch_scripts"
            referencedColumns: ["id"]
          },
        ]
      }
      video_batch_scripts: {
        Row: {
          batch_id: string
          content: string
          created_at: string
          id: string
          script_order: number
          title: string | null
          user_id: string
        }
        Insert: {
          batch_id: string
          content: string
          created_at?: string
          id?: string
          script_order: number
          title?: string | null
          user_id: string
        }
        Update: {
          batch_id?: string
          content?: string
          created_at?: string
          id?: string
          script_order?: number
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_batch_scripts_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "video_batch_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      video_edit_messages: {
        Row: {
          client_id: string
          content: string
          created_at: string
          created_by: string | null
          id: string
          metadata: Json
          result_video_id: string | null
          role: string
          source_video_id: string
        }
        Insert: {
          client_id: string
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          metadata?: Json
          result_video_id?: string | null
          role: string
          source_video_id: string
        }
        Update: {
          client_id?: string
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          metadata?: Json
          result_video_id?: string | null
          role?: string
          source_video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_edit_messages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "video_edit_messages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_edit_messages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "video_edit_messages_result_video_id_fkey"
            columns: ["result_video_id"]
            isOneToOne: false
            referencedRelation: "client_videos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_edit_messages_source_video_id_fkey"
            columns: ["source_video_id"]
            isOneToOne: false
            referencedRelation: "client_videos"
            referencedColumns: ["id"]
          },
        ]
      }
      video_projects: {
        Row: {
          aspect_ratio: string | null
          client_id: string | null
          created_at: string | null
          description: string | null
          duration_seconds: number | null
          id: string
          metadata: Json | null
          name: string
          output_url: string | null
          platform: string | null
          scenes: Json | null
          script_id: string | null
          status: string | null
          thumbnail_url: string | null
          updated_at: string | null
        }
        Insert: {
          aspect_ratio?: string | null
          client_id?: string | null
          created_at?: string | null
          description?: string | null
          duration_seconds?: number | null
          id?: string
          metadata?: Json | null
          name: string
          output_url?: string | null
          platform?: string | null
          scenes?: Json | null
          script_id?: string | null
          status?: string | null
          thumbnail_url?: string | null
          updated_at?: string | null
        }
        Update: {
          aspect_ratio?: string | null
          client_id?: string | null
          created_at?: string | null
          description?: string | null
          duration_seconds?: number | null
          id?: string
          metadata?: Json | null
          name?: string
          output_url?: string | null
          platform?: string | null
          scenes?: Json | null
          script_id?: string | null
          status?: string | null
          thumbnail_url?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "video_projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "video_projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "video_projects_script_id_fkey"
            columns: ["script_id"]
            isOneToOne: false
            referencedRelation: "ad_scripts"
            referencedColumns: ["id"]
          },
        ]
      }
      video_style_presets: {
        Row: {
          ai_trained_prompt: string | null
          builtin_key: string | null
          created_at: string
          id: string
          is_archived: boolean
          name: string
          prompt: string
          references: Json
          slug: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_trained_prompt?: string | null
          builtin_key?: string | null
          created_at?: string
          id?: string
          is_archived?: boolean
          name: string
          prompt?: string
          references?: Json
          slug?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_trained_prompt?: string | null
          builtin_key?: string | null
          created_at?: string
          id?: string
          is_archived?: boolean
          name?: string
          prompt?: string
          references?: Json
          slug?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      viral_tracking_targets: {
        Row: {
          client_id: string | null
          created_at: string | null
          display_name: string | null
          followers: number | null
          handle: string
          id: string
          is_active: boolean | null
          last_scraped_at: string | null
          platform: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          display_name?: string | null
          followers?: number | null
          handle: string
          id?: string
          is_active?: boolean | null
          last_scraped_at?: string | null
          platform: string
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          display_name?: string | null
          followers?: number | null
          handle?: string
          id?: string
          is_active?: boolean | null
          last_scraped_at?: string | null
          platform?: string
        }
        Relationships: [
          {
            foreignKeyName: "viral_tracking_targets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "viral_tracking_targets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "viral_tracking_targets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      viral_videos: {
        Row: {
          caption: string | null
          client_id: string | null
          comments: number | null
          created_at: string | null
          creator_followers: number | null
          creator_handle: string | null
          engagement_rate: number | null
          id: string
          is_tracked: boolean | null
          likes: number | null
          platform: string
          scraped_at: string | null
          shares: number | null
          thumbnail_url: string | null
          video_url: string
          views: number | null
        }
        Insert: {
          caption?: string | null
          client_id?: string | null
          comments?: number | null
          created_at?: string | null
          creator_followers?: number | null
          creator_handle?: string | null
          engagement_rate?: number | null
          id?: string
          is_tracked?: boolean | null
          likes?: number | null
          platform?: string
          scraped_at?: string | null
          shares?: number | null
          thumbnail_url?: string | null
          video_url: string
          views?: number | null
        }
        Update: {
          caption?: string | null
          client_id?: string | null
          comments?: number | null
          created_at?: string | null
          creator_followers?: number | null
          creator_handle?: string | null
          engagement_rate?: number | null
          id?: string
          is_tracked?: boolean | null
          likes?: number | null
          platform?: string
          scraped_at?: string | null
          shares?: number | null
          thumbnail_url?: string | null
          video_url?: string
          views?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "viral_videos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "viral_videos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "viral_videos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      voices: {
        Row: {
          accent: string | null
          created_at: string | null
          gender: string | null
          id: string
          is_active: boolean | null
          name: string
          preview_url: string | null
          provider: string
          style: string | null
          voice_id: string
        }
        Insert: {
          accent?: string | null
          created_at?: string | null
          gender?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          preview_url?: string | null
          provider?: string
          style?: string | null
          voice_id: string
        }
        Update: {
          accent?: string | null
          created_at?: string | null
          gender?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          preview_url?: string | null
          provider?: string
          style?: string | null
          voice_id?: string
        }
        Relationships: []
      }
      webhook_events: {
        Row: {
          client_id: string | null
          created_at: string
          enqueued_job_id: string | null
          event_type: string | null
          id: string
          processed_at: string | null
          provider: string
          provider_event_id: string
          raw_payload: Json | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          enqueued_job_id?: string | null
          event_type?: string | null
          id?: string
          processed_at?: string | null
          provider: string
          provider_event_id: string
          raw_payload?: Json | null
        }
        Update: {
          client_id?: string | null
          created_at?: string
          enqueued_job_id?: string | null
          event_type?: string | null
          id?: string
          processed_at?: string | null
          provider?: string
          provider_event_id?: string
          raw_payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "webhook_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "webhook_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "webhook_events_enqueued_job_id_fkey"
            columns: ["enqueued_job_id"]
            isOneToOne: false
            referencedRelation: "sync_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_logs: {
        Row: {
          client_id: string
          error_message: string | null
          id: string
          payload: Json | null
          processed_at: string
          status: string
          webhook_type: string
        }
        Insert: {
          client_id: string
          error_message?: string | null
          id?: string
          payload?: Json | null
          processed_at?: string
          status?: string
          webhook_type: string
        }
        Update: {
          client_id?: string
          error_message?: string | null
          id?: string
          payload?: Json | null
          processed_at?: string
          status?: string
          webhook_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "webhook_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      weekly_syncs: {
        Row: {
          action_items: string | null
          attendees: string | null
          blockers: string | null
          client_id: string
          created_at: string
          created_by: string | null
          crm_updated: boolean | null
          id: string
          meeting_id: string | null
          numbers_notes: string | null
          pipeline_notes: string | null
          recap_email_sent: boolean | null
          recording_storage_path: string | null
          recording_url: string | null
          sync_date: string
          updated_at: string
          wins: string | null
          working_not_working: string | null
        }
        Insert: {
          action_items?: string | null
          attendees?: string | null
          blockers?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          crm_updated?: boolean | null
          id?: string
          meeting_id?: string | null
          numbers_notes?: string | null
          pipeline_notes?: string | null
          recap_email_sent?: boolean | null
          recording_storage_path?: string | null
          recording_url?: string | null
          sync_date?: string
          updated_at?: string
          wins?: string | null
          working_not_working?: string | null
        }
        Update: {
          action_items?: string | null
          attendees?: string | null
          blockers?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          crm_updated?: boolean | null
          id?: string
          meeting_id?: string | null
          numbers_notes?: string | null
          pipeline_notes?: string | null
          recap_email_sent?: boolean | null
          recording_storage_path?: string | null
          recording_url?: string | null
          sync_date?: string
          updated_at?: string
          wins?: string | null
          working_not_working?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "weekly_syncs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "weekly_syncs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_syncs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "weekly_syncs_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "agency_meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_contacts: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          is_group: boolean
          jid: string
          last_message_at: string | null
          last_message_preview: string | null
          phone: string | null
          push_name: string | null
          session_id: string
          unread_count: number
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_group?: boolean
          jid: string
          last_message_at?: string | null
          last_message_preview?: string | null
          phone?: string | null
          push_name?: string | null
          session_id: string
          unread_count?: number
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_group?: boolean
          jid?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          phone?: string | null
          push_name?: string | null
          session_id?: string
          unread_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_contacts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          body: string | null
          contact_id: string | null
          created_at: string
          direction: string
          error: string | null
          id: string
          jid: string
          media_mime: string | null
          media_url: string | null
          message_type: string
          raw: Json | null
          sender_jid: string | null
          sender_name: string | null
          session_id: string
          status: string
          team_member_id: string | null
          wa_message_id: string | null
          wa_timestamp: string | null
        }
        Insert: {
          body?: string | null
          contact_id?: string | null
          created_at?: string
          direction: string
          error?: string | null
          id?: string
          jid: string
          media_mime?: string | null
          media_url?: string | null
          message_type?: string
          raw?: Json | null
          sender_jid?: string | null
          sender_name?: string | null
          session_id: string
          status?: string
          team_member_id?: string | null
          wa_message_id?: string | null
          wa_timestamp?: string | null
        }
        Update: {
          body?: string | null
          contact_id?: string | null
          created_at?: string
          direction?: string
          error?: string | null
          id?: string
          jid?: string
          media_mime?: string | null
          media_url?: string | null
          message_type?: string
          raw?: Json | null
          sender_jid?: string | null
          sender_name?: string | null
          session_id?: string
          status?: string
          team_member_id?: string | null
          wa_message_id?: string | null
          wa_timestamp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "agency_members"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_sessions: {
        Row: {
          bridge_meta: Json | null
          created_at: string
          id: string
          label: string
          last_connected_at: string | null
          last_error: string | null
          last_qr: string | null
          last_qr_at: string | null
          phone_number: string | null
          status: string
          updated_at: string
        }
        Insert: {
          bridge_meta?: Json | null
          created_at?: string
          id?: string
          label?: string
          last_connected_at?: string | null
          last_error?: string | null
          last_qr?: string | null
          last_qr_at?: string | null
          phone_number?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          bridge_meta?: Json | null
          created_at?: string
          id?: string
          label?: string
          last_connected_at?: string | null
          last_error?: string | null
          last_qr?: string | null
          last_qr_at?: string | null
          phone_number?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      client_sync_health: {
        Row: {
          client_id: string | null
          client_name: string | null
          client_status: string | null
          consecutive_ghl_failures: number | null
          consecutive_meta_failures: number | null
          expected_data_present: boolean | null
          ghl_hours_since_success: number | null
          ghl_location_id: string | null
          has_ghl_credentials: boolean | null
          last_ghl_attempt_at: string | null
          last_ghl_attempt_status: string | null
          last_ghl_error: string | null
          last_ghl_success_at: string | null
          last_meta_attempt_at: string | null
          last_meta_attempt_status: string | null
          last_meta_error: string | null
          last_meta_success_at: string | null
          meta_ad_account_id: string | null
          meta_hours_since_success: number | null
          overall_health: string | null
          recent_leads: number | null
          recent_spend: number | null
        }
        Relationships: []
      }
      v_agency_enrichment_kpis: {
        Row: {
          accredited_found: number | null
          coverage_pct: number | null
          daily_enrichments: number | null
          estimated_prospect_value: number | null
          last_sync_at: string | null
          millionaires_found: number | null
          total_clients: number | null
          total_contacts: number | null
          total_enriched: number | null
        }
        Relationships: []
      }
      v_agency_performance_monthly: {
        Row: {
          ad_spend: number | null
          calls: number | null
          client_count: number | null
          commitment_dollars: number | null
          commitments: number | null
          cost_of_capital_pct: number | null
          cpa: number | null
          cpl: number | null
          dollar_per_call: number | null
          dollar_per_show: number | null
          funded_count: number | null
          funded_dollars: number | null
          leads: number | null
          month_start: string | null
          show_pct: number | null
          showed_calls: number | null
        }
        Relationships: []
      }
      v_agency_performance_weekly: {
        Row: {
          ad_spend: number | null
          client_count: number | null
          cost_of_capital_pct: number | null
          funded_dollars: number | null
          week_start: string | null
        }
        Relationships: []
      }
      v_client_enrichment_coverage: {
        Row: {
          client_id: string | null
          client_name: string | null
          coverage_pct: number | null
          enriched_contacts: number | null
          failed_matches: number | null
          last_24h: number | null
          last_7d: number | null
          last_run_at: string | null
          total_contacts: number | null
        }
        Relationships: []
      }
      v_client_performance_daily: {
        Row: {
          ad_spend: number | null
          calls: number | null
          clicks: number | null
          client_id: string | null
          client_name: string | null
          commitment_dollars: number | null
          commitments: number | null
          cost_of_capital_pct: number | null
          cpa: number | null
          cpl: number | null
          ctr: number | null
          date: string | null
          date_account_tz: string | null
          dollar_per_call: number | null
          dollar_per_show: number | null
          funded_count: number | null
          funded_dollars: number | null
          id: string | null
          impressions: number | null
          leads: number | null
          reconnect_calls: number | null
          reconnect_showed: number | null
          show_pct: number | null
          showed_calls: number | null
          spam_leads: number | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_metrics_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "daily_metrics_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_metrics_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      v_client_performance_monthly: {
        Row: {
          ad_spend: number | null
          calls: number | null
          clicks: number | null
          client_id: string | null
          client_name: string | null
          commitment_dollars: number | null
          commitments: number | null
          cost_of_capital_pct: number | null
          cpa: number | null
          cpl: number | null
          ctr: number | null
          dollar_per_call: number | null
          dollar_per_show: number | null
          funded_count: number | null
          funded_dollars: number | null
          impressions: number | null
          leads: number | null
          month_start: string | null
          reconnect_calls: number | null
          reconnect_showed: number | null
          show_pct: number | null
          showed_calls: number | null
          spam_leads: number | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_metrics_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "daily_metrics_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_metrics_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      v_client_performance_weekly: {
        Row: {
          ad_spend: number | null
          calls: number | null
          clicks: number | null
          client_id: string | null
          client_name: string | null
          commitment_dollars: number | null
          commitments: number | null
          cost_of_capital_pct: number | null
          cpa: number | null
          cpl: number | null
          ctr: number | null
          dollar_per_call: number | null
          dollar_per_show: number | null
          funded_count: number | null
          funded_dollars: number | null
          impressions: number | null
          leads: number | null
          reconnect_calls: number | null
          reconnect_showed: number | null
          show_pct: number | null
          showed_calls: number | null
          spam_leads: number | null
          week_start: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_metrics_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_sync_health"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "daily_metrics_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_metrics_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_client_enrichment_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      v_gmail_accounts: {
        Row: {
          created_at: string | null
          display_name: string | null
          email: string | null
          history_id: string | null
          id: string | null
          last_synced_at: string | null
          owner_member_id: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          display_name?: string | null
          email?: string | null
          history_id?: string | null
          id?: string | null
          last_synced_at?: string | null
          owner_member_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          display_name?: string | null
          email?: string | null
          history_id?: string | null
          id?: string | null
          last_synced_at?: string | null
          owner_member_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gmail_accounts_owner_member_id_fkey"
            columns: ["owner_member_id"]
            isOneToOne: false
            referencedRelation: "agency_members"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      find_unenriched_leads: {
        Args: { p_client_id: string; p_limit?: number }
        Returns: {
          email: string
          external_id: string
          id: string
          name: string
          phone: string
        }[]
      }
      generate_client_slug: { Args: { client_name: string }; Returns: string }
      get_api_usage_counts: {
        Args: { p_key_index: number; p_service: string }
        Returns: {
          daily_count: number
          minute_count: number
        }[]
      }
      get_client_source_metrics: {
        Args: { p_end_date?: string; p_start_date?: string }
        Returns: {
          avg_calls_to_fund: number
          avg_time_to_fund: number
          client_id: string
          commitment_dollars: number
          funded_count: number
          funded_dollars: number
          reconnect_calls: number
          reconnect_showed: number
          showed_calls: number
          spam_leads: number
          total_calls: number
          total_leads: number
        }[]
      }
      get_sync_queue_stats: {
        Args: never
        Returns: {
          completed_count: number
          failed_count: number
          pending_count: number
          processing_count: number
          total_records_processed: number
        }[]
      }
      get_top_performers: {
        Args: { p_client_ids?: string[] }
        Returns: {
          client_id: string
          cost_per_funded: number
          cost_per_lead: number
          entity_id: string
          funded: number
          funded_dollars: number
          leads: number
          meta_id: string
          name: string
          scope: string
          spend: number
          thumbnail_url: string
        }[]
      }
      log_cron_run: {
        Args: {
          p_duration_ms?: number
          p_error_message?: string
          p_job_name: string
          p_response_body?: string
          p_status: string
          p_status_code?: number
        }
        Returns: string
      }
      queue_client_sync: {
        Args: { p_client_id: string; p_days_back?: number }
        Returns: number
      }
      queue_full_sync_all_clients: {
        Args: { p_days_back?: number }
        Returns: number
      }
    }
    Enums: {
      email_classification:
        | "important_human"
        | "client"
        | "sales"
        | "partner_vendor"
        | "internal"
        | "newsletter"
        | "promotional"
        | "cold_outreach"
        | "spam"
        | "unclassified"
      email_draft_status:
        | "pending"
        | "approved"
        | "sent"
        | "edited"
        | "dismissed"
      email_priority: "high" | "medium" | "low" | "none"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      email_classification: [
        "important_human",
        "client",
        "sales",
        "partner_vendor",
        "internal",
        "newsletter",
        "promotional",
        "cold_outreach",
        "spam",
        "unclassified",
      ],
      email_draft_status: [
        "pending",
        "approved",
        "sent",
        "edited",
        "dismissed",
      ],
      email_priority: ["high", "medium", "low", "none"],
    },
  },
} as const
