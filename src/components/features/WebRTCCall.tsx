import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

// ── Types ──────────────────────────────────────────────────────────────────
interface CallRecord {
  id: string;
  caller_id: string;
  callee_id: string;
  call_type: 'audio' | 'video';
  status: 'ringing' | 'active' | 'ended' | 'declined';
  offer: string | null;
  answer: string | null;
  caller_candidates: any[];
  callee_candidates: any[];
  created_at: string;
}

interface CallerProfile {
  id: string;
  username: string;
  avatar_url: string | null;
}

// ── Incoming call UI ───────────────────────────────────────────────────────
function IncomingCallScreen({
  call,
  caller,
  onAccept,
  onDecline,
}: {
  call: CallRecord;
  caller: CallerProfile | null;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const displayName = caller?.username || 'Unknown';
  const isVideo = call.call_type === 'video';

  return (
    <div
      className="fixed inset-0 z-[700] flex flex-col items-center justify-between"
      style={{
        background: 'linear-gradient(160deg, #0a0a1a 0%, #1a0030 100%)',
        paddingTop: 'max(60px, env(safe-area-inset-top))',
        paddingBottom: 'max(60px, env(safe-area-inset-bottom))',
      }}
    >
      {/* Pulse rings */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {[1, 2, 3].map(i => (
          <div
            key={i}
            className="absolute rounded-full border border-primary/20"
            style={{
              width: `${120 + i * 70}px`,
              height: `${120 + i * 70}px`,
              animation: `ping ${1 + i * 0.4}s cubic-bezier(0,0,0.2,1) infinite`,
              animationDelay: `${i * 0.3}s`,
              opacity: 0.3 / i,
            }}
          />
        ))}
      </div>

      {/* Caller info */}
      <div className="flex flex-col items-center gap-4 z-10">
        <div
          className="w-28 h-28 rounded-full overflow-hidden flex items-center justify-center text-4xl font-black text-white ring-4 ring-primary/40"
          style={{ background: 'linear-gradient(135deg, #FF1493, #FF69B4)' }}
        >
          {caller?.avatar_url ? (
            <img src={caller.avatar_url} alt="" className="w-full h-full object-cover" />
          ) : (
            (displayName[0] || '?').toUpperCase()
          )}
        </div>
        <div className="text-center">
          <p className="text-2xl font-black text-white">{displayName}</p>
          <p className="text-white/60 text-sm mt-1">
            Incoming {isVideo ? 'Video' : 'Audio'} Call...
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-16 z-10">
        {/* Decline */}
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={onDecline}
            className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center press shadow-lg"
            style={{ boxShadow: '0 4px 24px rgba(239,68,68,0.5)' }}
          >
            <PhoneOff className="w-7 h-7 text-white" />
          </button>
          <span className="text-white/60 text-xs">Decline</span>
        </div>
        {/* Accept */}
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={onAccept}
            className="w-16 h-16 rounded-full flex items-center justify-center press shadow-lg"
            style={{
              background: 'linear-gradient(135deg, #22c55e, #16a34a)',
              boxShadow: '0 4px 24px rgba(34,197,94,0.5)',
            }}
          >
            {isVideo ? <Video className="w-7 h-7 text-white" /> : <Phone className="w-7 h-7 text-white" />}
          </button>
          <span className="text-white/60 text-xs">Accept</span>
        </div>
      </div>
    </div>
  );
}

// ── Active call UI ─────────────────────────────────────────────────────────
function ActiveCallScreen({
  call,
  remoteProfile,
  localStream,
  remoteStream,
  isVideo,
  onHangup,
}: {
  call: CallRecord;
  remoteProfile: CallerProfile | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isVideo: boolean;
  onHangup: () => void;
}) {
  const [micOn, setMicOn] = useState(true);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [camOn, setCamOn] = useState(isVideo);
  const [elapsed, setElapsed] = useState(0);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteStream) {
      if (isVideo && remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
      } else if (!isVideo && remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStream;
      }
    }
  }, [remoteStream, isVideo]);

  useEffect(() => {
    const iv = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  function toggleMic() {
    const track = localStream?.getAudioTracks()[0];
    if (track) { track.enabled = !track.enabled; setMicOn(track.enabled); }
  }

  function toggleCam() {
    const track = localStream?.getVideoTracks()[0];
    if (track) { track.enabled = !track.enabled; setCamOn(track.enabled); }
  }

  function toggleSpeaker() {
    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = speakerOn;
    }
    setSpeakerOn(s => !s);
  }

  const fmt = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
  const displayName = remoteProfile?.username || 'Unknown';

  return (
    <div
      className="fixed inset-0 z-[700] flex flex-col"
      style={{
        background: isVideo ? '#000' : 'linear-gradient(160deg, #0a0a1a 0%, #1a0030 100%)',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'max(24px, env(safe-area-inset-bottom))',
      }}
    >
      {/* Remote video (full screen) */}
      {isVideo && (
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
          style={{ zIndex: 0 }}
        />
      )}

      {/* Audio-only remote */}
      {!isVideo && <audio ref={remoteAudioRef} autoPlay playsInline />}

      {/* Overlay for audio calls */}
      {!isVideo && (
        <div className="flex-1 flex flex-col items-center justify-center gap-5 z-10">
          <div
            className="w-28 h-28 rounded-full overflow-hidden flex items-center justify-center text-4xl font-black text-white ring-4 ring-primary/40"
            style={{ background: 'linear-gradient(135deg, #FF1493, #FF69B4)' }}
          >
            {remoteProfile?.avatar_url ? (
              <img src={remoteProfile.avatar_url} alt="" className="w-full h-full object-cover" />
            ) : (
              (displayName[0] || '?').toUpperCase()
            )}
          </div>
          <div className="text-center">
            <p className="text-2xl font-black text-white">{displayName}</p>
            <p className="text-primary text-sm font-mono mt-1">{fmt(elapsed)}</p>
          </div>
        </div>
      )}

      {/* Video overlay info */}
      {isVideo && (
        <div className="relative z-10 px-4 pt-4 flex items-center justify-between">
          <div>
            <p className="text-white font-black text-base drop-shadow">{displayName}</p>
            <p className="text-white/70 text-xs font-mono">{fmt(elapsed)}</p>
          </div>
        </div>
      )}

      {/* Local video PiP */}
      {isVideo && (
        <div
          className="absolute bottom-28 right-4 z-20 w-24 h-36 rounded-2xl overflow-hidden border-2 border-white/20 shadow-xl"
          style={{ backdropFilter: 'blur(8px)' }}
        >
          <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
          {!camOn && <div className="absolute inset-0 bg-gray-900 flex items-center justify-center"><VideoOff className="w-5 h-5 text-white/50" /></div>}
        </div>
      )}

      {/* Controls */}
      <div
        className="relative z-10 flex items-center justify-center gap-5 px-6 py-4"
        style={{ marginTop: isVideo ? 'auto' : 0 }}
      >
        <button
          onClick={toggleMic}
          className={`w-14 h-14 rounded-full flex items-center justify-center press transition-all ${micOn ? 'bg-white/15 border border-white/20' : 'bg-red-500'}`}
          style={{ backdropFilter: 'blur(8px)' }}
        >
          {micOn ? <Mic className="w-6 h-6 text-white" /> : <MicOff className="w-6 h-6 text-white" />}
        </button>

        {!isVideo && (
          <button
            onClick={toggleSpeaker}
            className={`w-14 h-14 rounded-full flex items-center justify-center press transition-all ${speakerOn ? 'bg-white/15 border border-white/20' : 'bg-red-500'}`}
            style={{ backdropFilter: 'blur(8px)' }}
          >
            {speakerOn ? <Volume2 className="w-6 h-6 text-white" /> : <VolumeX className="w-6 h-6 text-white" />}
          </button>
        )}

        <button
          onClick={onHangup}
          className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center press shadow-xl"
          style={{ boxShadow: '0 4px 24px rgba(239,68,68,0.5)' }}
        >
          <PhoneOff className="w-7 h-7 text-white" />
        </button>

        {isVideo && (
          <button
            onClick={toggleCam}
            className={`w-14 h-14 rounded-full flex items-center justify-center press transition-all ${camOn ? 'bg-white/15 border border-white/20' : 'bg-red-500'}`}
            style={{ backdropFilter: 'blur(8px)' }}
          >
            {camOn ? <Video className="w-6 h-6 text-white" /> : <VideoOff className="w-6 h-6 text-white" />}
          </button>
        )}
      </div>
    </div>
  );
}

// ── GlobalCallListener ─────────────────────────────────────────────────────
// Placed in App.tsx — listens for incoming calls globally across all pages.
export function GlobalCallListener() {
  const { user } = useAuth();
  const [incomingCall, setIncomingCall] = useState<CallRecord | null>(null);
  const [callerProfile, setCallerProfile] = useState<CallerProfile | null>(null);
  const [activeCall, setActiveCall] = useState<CallRecord | null>(null);
  const [remoteProfile, setRemoteProfile] = useState<CallerProfile | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);
  const callIdRef = useRef<string | null>(null);

  const cleanup = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    localStream?.getTracks().forEach(t => t.stop());
    setLocalStream(null);
    setRemoteStream(null);
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    ringtoneRef.current?.pause();
    callIdRef.current = null;
  }, [localStream]);

  // Poll for incoming calls directed at this user
  useEffect(() => {
    if (!user) return;
    const iv = setInterval(async () => {
      if (activeCall || incomingCall) return;
      const { data } = await supabase
        .from('calls')
        .select('*')
        .eq('callee_id', user.id)
        .eq('status', 'ringing')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      if (data && callIdRef.current !== data.id) {
        callIdRef.current = data.id;
        setIncomingCall(data as CallRecord);
        // Fetch caller profile
        supabase.from('user_profiles').select('id, username, avatar_url').eq('id', data.caller_id).single()
          .then(({ data: p }) => { if (p) setCallerProfile(p as CallerProfile); });
      }
    }, 3000);
    return () => clearInterval(iv);
  }, [user, activeCall, incomingCall]);

  async function acceptCall() {
    if (!incomingCall || !user) return;
    ringtoneRef.current?.pause();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: incomingCall.call_type === 'video',
      });
      setLocalStream(stream);

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      pcRef.current = pc;
      const rs = new MediaStream();
      setRemoteStream(rs);

      stream.getTracks().forEach(t => pc.addTrack(t, stream));
      pc.ontrack = e => { e.streams[0].getTracks().forEach(t => rs.addTrack(t)); };

      // Set remote offer
      if (incomingCall.offer) {
        await pc.setRemoteDescription(JSON.parse(incomingCall.offer));
      }

      // Add existing ICE candidates from caller
      const existingCandidates: any[] = Array.isArray(incomingCall.caller_candidates)
        ? incomingCall.caller_candidates : [];
      for (const c of existingCandidates) {
        try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      const iceCandidates: any[] = [];
      pc.onicecandidate = async e => {
        if (e.candidate) {
          iceCandidates.push(e.candidate.toJSON());
          await supabase.from('calls').update({
            callee_candidates: iceCandidates,
          }).eq('id', incomingCall.id);
        }
      };

      await supabase.from('calls').update({
        status: 'active',
        answer: JSON.stringify(pc.localDescription),
        started_at: new Date().toISOString(),
      }).eq('id', incomingCall.id);

      setActiveCall(incomingCall);
      setRemoteProfile(callerProfile);
      setIncomingCall(null);
      setCallerProfile(null);

      // Poll for status changes (hangup)
      pollRef.current = setInterval(async () => {
        const { data } = await supabase.from('calls').select('status').eq('id', incomingCall.id).single();
        if (data?.status === 'ended') { endCall(incomingCall.id); }
      }, 3000);

    } catch {
      toast.error('Could not access camera/microphone');
      setIncomingCall(null);
    }
  }

  async function declineCall() {
    if (!incomingCall) return;
    ringtoneRef.current?.pause();
    await supabase.from('calls').update({ status: 'declined', ended_at: new Date().toISOString() }).eq('id', incomingCall.id);
    setIncomingCall(null);
    setCallerProfile(null);
    callIdRef.current = null;
  }

  async function endCall(callId?: string) {
    const id = callId || activeCall?.id;
    if (id) {
      await supabase.from('calls').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', id);
    }
    cleanup();
    setActiveCall(null);
    setRemoteProfile(null);
  }

  if (!user) return null;

  return (
    <>
      {incomingCall && !activeCall && (
        <IncomingCallScreen
          call={incomingCall}
          caller={callerProfile}
          onAccept={acceptCall}
          onDecline={declineCall}
        />
      )}
      {activeCall && (
        <ActiveCallScreen
          call={activeCall}
          remoteProfile={remoteProfile}
          localStream={localStream}
          remoteStream={remoteStream}
          isVideo={activeCall.call_type === 'video'}
          onHangup={() => endCall()}
        />
      )}
    </>
  );
}

// ── useStartCall hook ──────────────────────────────────────────────────────
// Use this hook in Messenger or any page to initiate a call.
export function useStartCall() {
  const { user } = useAuth();
  const [outgoingCall, setOutgoingCall] = useState<CallRecord | null>(null);
  const [remoteProfile, setRemoteProfile] = useState<CallerProfile | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    localStream?.getTracks().forEach(t => t.stop());
    setLocalStream(null);
    setRemoteStream(null);
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, [localStream]);

  async function startCall(calleeId: string, callType: 'audio' | 'video' = 'audio') {
    if (!user) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: callType === 'video',
      });
      setLocalStream(stream);

      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      pcRef.current = pc;
      const rs = new MediaStream();
      setRemoteStream(rs);
      stream.getTracks().forEach(t => pc.addTrack(t, stream));
      pc.ontrack = e => { e.streams[0].getTracks().forEach(t => rs.addTrack(t)); };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const iceCandidates: any[] = [];
      pc.onicecandidate = async e => {
        if (e.candidate) iceCandidates.push(e.candidate.toJSON());
      };

      const { data: callRow, error } = await supabase.from('calls').insert({
        caller_id: user.id,
        callee_id: calleeId,
        call_type: callType,
        status: 'ringing',
        offer: JSON.stringify(pc.localDescription),
        caller_candidates: [],
      }).select().single();

      if (error || !callRow) { cleanup(); toast.error('Failed to start call'); return; }

      setOutgoingCall(callRow as CallRecord);
      const { data: rp } = await supabase.from('user_profiles').select('id, username, avatar_url').eq('id', calleeId).single();
      if (rp) setRemoteProfile(rp as CallerProfile);

      // Poll for answer/end
      pollRef.current = setInterval(async () => {
        const { data } = await supabase.from('calls').select('*').eq('id', callRow.id).single();
        if (!data) return;
        if (data.status === 'active' && data.answer && !pc.remoteDescription) {
          await pc.setRemoteDescription(JSON.parse(data.answer));
          const calleeCands: any[] = Array.isArray(data.callee_candidates) ? data.callee_candidates : [];
          for (const c of calleeCands) { try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {} }
          // Push our ICE candidates
          await supabase.from('calls').update({ caller_candidates: iceCandidates }).eq('id', callRow.id);
        }
        if (data.status === 'declined') {
          toast.error('Call declined');
          cleanup();
          setOutgoingCall(null);
          setRemoteProfile(null);
        }
        if (data.status === 'ended') {
          cleanup();
          setOutgoingCall(null);
          setRemoteProfile(null);
        }
      }, 2000);

    } catch {
      toast.error('Could not access camera/microphone');
      cleanup();
    }
  }

  async function endCall() {
    if (outgoingCall) {
      await supabase.from('calls').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', outgoingCall.id);
    }
    cleanup();
    setOutgoingCall(null);
    setRemoteProfile(null);
  }

  const CallComponent: React.FC = useCallback(() => {
    if (!outgoingCall) return null;
    const isAnswered = !!remoteStream && outgoingCall.status === 'active';
    if (!isAnswered) {
      // Outgoing / ringing state
      return (
        <div
          className="fixed inset-0 z-[700] flex flex-col items-center justify-between"
          style={{
            background: 'linear-gradient(160deg, #0a0a1a 0%, #1a0030 100%)',
            paddingTop: 'max(80px, env(safe-area-inset-top))',
            paddingBottom: 'max(80px, env(safe-area-inset-bottom))',
          }}
        >
          <div className="flex flex-col items-center gap-4">
            <div
              className="w-28 h-28 rounded-full overflow-hidden flex items-center justify-center text-4xl font-black text-white ring-4 ring-primary/40"
              style={{ background: 'linear-gradient(135deg, #FF1493, #FF69B4)' }}
            >
              {remoteProfile?.avatar_url
                ? <img src={remoteProfile.avatar_url} alt="" className="w-full h-full object-cover" />
                : (remoteProfile?.username?.[0] || '?').toUpperCase()
              }
            </div>
            <div className="text-center">
              <p className="text-2xl font-black text-white">{remoteProfile?.username || 'Unknown'}</p>
              <p className="text-white/50 text-sm mt-1">Calling...</p>
            </div>
          </div>
          <button
            onClick={endCall}
            className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center press"
            style={{ boxShadow: '0 4px 24px rgba(239,68,68,0.5)' }}
          >
            <PhoneOff className="w-7 h-7 text-white" />
          </button>
        </div>
      );
    }
    return (
      <ActiveCallScreen
        call={outgoingCall}
        remoteProfile={remoteProfile}
        localStream={localStream}
        remoteStream={remoteStream}
        isVideo={outgoingCall.call_type === 'video'}
        onHangup={endCall}
      />
    );
  }, [outgoingCall, remoteProfile, localStream, remoteStream]);

  return { startCall, endCall, CallComponent };
}

export default GlobalCallListener;
