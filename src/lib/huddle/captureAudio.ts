// Captures microphone audio and, when the user allows it, mixes in system/tab
// audio via getDisplayMedia so recordings include remote participants on
// Zoom/Meet/etc. Falls back to mic-only if the user cancels the share prompt
// or the browser does not support tab-audio capture.

export interface MixedCaptureResult {
  stream: MediaStream;
  micStream: MediaStream;
  displayStream: MediaStream | null;
  audioContext: AudioContext | null;
  includesSystemAudio: boolean;
  stop: () => void;
}

export type TabAudioErrorKind = 'cancelled' | 'no-audio' | 'unsupported';

export class TabAudioError extends Error {
  kind: TabAudioErrorKind;
  constructor(kind: TabAudioErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = 'TabAudioError';
  }
}

/**
 * Opens the Chrome share picker pre-targeted at the "Chrome Tab" pane so the
 * "Also share tab audio" checkbox is the only thing the user has to tick.
 * Returns a stream containing ONLY the shared audio track.
 */
export async function requestTabAudioStream(): Promise<MediaStream> {
  const md: any = navigator.mediaDevices as any;
  if (!md?.getDisplayMedia) {
    throw new TabAudioError('unsupported', 'This browser cannot capture tab audio. Use desktop Chrome or Edge.');
  }

  let display: MediaStream;
  try {
    display = await md.getDisplayMedia({
      // Chrome requires a video track even for audio-only capture.
      video: { displaySurface: 'browser' },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      // Chrome-only hints: open on the Tab pane, allow the meeting tab to be
      // listed, allow switching surfaces, and offer system audio on Windows.
      preferCurrentTab: false,
      selfBrowserSurface: 'exclude',
      systemAudio: 'include',
      surfaceSwitching: 'include',
      monitorTypeSurfaces: 'include',
    } as any);
  } catch (e: any) {
    throw new TabAudioError('cancelled', 'Share dialog was dismissed before a tab was picked.');
  }

  display.getVideoTracks().forEach((t) => t.stop());
  if (!display.getAudioTracks().length) {
    display.getTracks().forEach((t) => t.stop());
    throw new TabAudioError('no-audio', 'That share had no audio — the "Also share tab audio" toggle was left off.');
  }
  return display;
}

export async function captureMicPlusSystemAudio(
  opts: { requestSystem?: boolean } = {},
): Promise<MixedCaptureResult> {
  const micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });

  let displayStream: MediaStream | null = null;
  if (opts.requestSystem !== false && (navigator.mediaDevices as any).getDisplayMedia) {
    try {
      displayStream = await (navigator.mediaDevices as any).getDisplayMedia({
        video: true, // Chrome requires video:true even when we only want audio
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      // Discard the video track — we only need audio.
      displayStream?.getVideoTracks().forEach((t) => t.stop());
      if (!displayStream?.getAudioTracks().length) {
        displayStream?.getTracks().forEach((t) => t.stop());
        displayStream = null;
      }
    } catch (e) {
      // User cancelled or browser blocked — carry on with mic-only.
      displayStream = null;
    }
  }

  if (!displayStream) {
    return {
      stream: micStream,
      micStream,
      displayStream: null,
      audioContext: null,
      includesSystemAudio: false,
      stop: () => {
        micStream.getTracks().forEach((t) => t.stop());
      },
    };
  }

  // Mix mic + system audio through a Web Audio graph.
  const AudioCtx: typeof AudioContext =
    (window as any).AudioContext || (window as any).webkitAudioContext;
  const ctx = new AudioCtx();
  const dest = ctx.createMediaStreamDestination();
  const micSource = ctx.createMediaStreamSource(micStream);
  const sysSource = ctx.createMediaStreamSource(displayStream);
  micSource.connect(dest);
  sysSource.connect(dest);

  return {
    stream: dest.stream,
    micStream,
    displayStream,
    audioContext: ctx,
    includesSystemAudio: true,
    stop: () => {
      try { micStream.getTracks().forEach((t) => t.stop()); } catch {}
      try { displayStream?.getTracks().forEach((t) => t.stop()); } catch {}
      try { ctx.close(); } catch {}
    },
  };
}