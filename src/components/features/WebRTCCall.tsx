import { useState, useEffect, useRef, useCallback } from 'react';
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff, X, PhoneCall } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

// ── Types ──
interface CallUser {
  id: string;
  username: string;
  avatar?: string;
}

interface ActiveCall {
  id: string;
  remoteUser: CallUser;
  callType: 'audio' | 'video';
  isInitiator: boolean;
}

interface IncomingCall {
  id: string;
  caller: CallUser;
  callType: 'audio' | 'video';
}

// ── useCall hook ──
export function useCall() {
  const { user } = useAuth();
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [callBg, setCallBg] = useState('linear-gradient(135deg, #0d0d1a 0%, #1a0026 100%)');

  useEffect(() => {
    supabase
      .from('site_settings')
      .select('bg_gradient_from,bg_gradient_to')
      .eq('id', 'main')
      .single()
      .then(({ data }) => {
        if (data) {
          const from = (data as any).bg_gradient_from || '#0d0d1a';
          const to = (data as any).bg_gradient_to || '#1a0026';
          setCallBg(`linear-gradient(135deg, ${from} 0%, ${to} 100%)`);
        }
      });
  }, []);

  const startCall = useCallback(
    async (remoteUser: CallUser, callType: 'audio' | 'video') => {
      if (!user) return;
      try {
        const { data, error } = await supabase
          .from('calls')
          .insert({
            caller_id: user.id,
            callee_id: remoteUser.id,
            call_type: callType,
            status: 'ringing',
          })
          .select()
          .single();

        if (error) throw error;

        setActiveCall({
          id: data.id,
          remoteUser,
          callType,
          isInitiator: true,
        });
      } catch (err) {
        console.error('startCall error:', err);
        toast.error('Failed to start call');
      }
    },
    [user]
  );

  return { startCall, activeCall, setActiveCall, callBg };
}

// ── ActiveCallScreen ──
interface ActiveCallScreenProps {
  callId: string;
  localUser: CallUser;
  remoteUser: CallUser;
  callType: 'audio' | 'video';
  isInitiator: boolean;
  callBg: string;
  onEnd: () => void;
}

export function ActiveCallScreen({
  callId,
  localUser,
  remoteUser,
  callType,
  callBg,
  onEnd,
}: ActiveCallScreenProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [duration, setDuration] = useState(0);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'ended'>('connecting');
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const durationRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const endCall = useCallback(async () => {
    if (durationRef.current) clearInterval(durationRef.current);
    if (pollRef.current) clearInterval(pollRef.current);
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
    }
    if (pcRef.current) {
      pcRef.current.close();
    }
    await supabase
      .from('calls')
      .update({ status: 'ended', ended_at: new Date().toISOString() })
      .eq('id', callId);
    setStatus('ended');
    onEnd();
  }, [callId, onEnd]);

  useEffect(() => {
    let mounted = true;

    async function setup() {
      try {
        const constraints: MediaStreamConstraints =
          callType === 'video' ? { video: true, audio: true } : { audio: true };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        localStreamRef.current = stream;

        if (localVideoRef.current && callType === 'video') {
          localVideoRef.current.srcObject = stream;
        }

        if (mounted) {
          setStatus('connected');
          durationRef.current = setInterval(() => {
            setDuration((d) => d + 1);
          }, 1000);
        }
      } catch (err) {
        console.error('Media setup error:', err);
        if (mounted) {
          setStatus('connected');
          durationRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
        }
      }
    }

    setup();

    // Poll call status
    pollRef.current = setInterval(async () => {
      const { data } = await supabase
        .from('calls')
        .select('status')
        .eq('id', callId)
        .single();
      if (data?.status === 'ended' && mounted) {
        endCall();
      }
    }, 3000);

    return () => {
      mounted = false;
      if (durationRef.current) clearInterval(durationRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [callId, callType, endCall]);

  const toggleMute = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((t) => {
        t.enabled = isMuted;
      });
    }
    setIsMuted((m) => !m);
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach((t) => {
        t.enabled = isVideoOff;
      });
    }
    setIsVideoOff((v) => !v);
  };

  return (
    <div
      className="fixed inset-0 z-[900] flex flex-col items-center justify-between"
      style={{ background: callBg }}
    >
      {/* Remote video / avatar */}
      <div className="flex-1 w-full relative flex items-center justify-center">
        {callType === 'video' ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />
        ) : null}

        {/* Remote avatar overlay */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
          <div className="w-24 h-24 rounded-full overflow-hidden bg-white/10 backdrop-blur-sm border-2 border-white/20 flex items-center justify-center">
            {remoteUser.avatar ? (
              <img src={remoteUser.avatar} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-3xl font-black text-white">
                {(remoteUser.username || '?')[0].toUpperCase()}
              </span>
            )}
          </div>
          <div className="text-center">
            <p className="text-white font-black text-xl">{remoteUser.username}</p>
            <p className="text-white/60 text-sm mt-1">
              {status === 'connecting'
                ? 'Connecting...'
                : status === 'ended'
                ? 'Call ended'
                : formatDuration(duration)}
            </p>
          </div>
        </div>

        {/* Local video PiP */}
        {callType === 'video' && (
          <div className="absolute bottom-4 right-4 w-24 h-32 rounded-2xl overflow-hidden border-2 border-white/20 bg-black/40">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover transform scale-x-[-1]"
            />
          </div>
        )}
      </div>

      {/* Controls */}
      <div
        className="w-full flex items-center justify-center gap-6 px-8 pb-12 pt-6"
        style={{
          background:
            'linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 100%)',
          paddingBottom: 'max(48px, env(safe-area-inset-bottom))',
        }}
      >
        {/* Mute */}
        <button
          onClick={toggleMute}
          className="w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-95"
          style={{
            background: isMuted ? 'rgba(255,59,48,0.8)' : 'rgba(255,255,255,0.15)',
            backdropFilter: 'blur(10px)',
          }}
        >
          {isMuted ? (
            <MicOff className="w-6 h-6 text-white" />
          ) : (
            <Mic className="w-6 h-6 text-white" />
          )}
        </button>

        {/* End call */}
        <button
          onClick={endCall}
          className="w-16 h-16 rounded-full flex items-center justify-center transition-all active:scale-95"
          style={{ background: '#FF3B30', boxShadow: '0 4px 20px rgba(255,59,48,0.5)' }}
        >
          <PhoneOff className="w-7 h-7 text-white" />
        </button>

        {/* Video toggle */}
        {callType === 'video' ? (
          <button
            onClick={toggleVideo}
            className="w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-95"
            style={{
              background: isVideoOff
                ? 'rgba(255,59,48,0.8)'
                : 'rgba(255,255,255,0.15)',
              backdropFilter: 'blur(10px)',
            }}
          >
            {isVideoOff ? (
              <VideoOff className="w-6 h-6 text-white" />
            ) : (
              <Video className="w-6 h-6 text-white" />
            )}
          </button>
        ) : (
          <div className="w-14 h-14" />
        )}
      </div>
    </div>
  );
}

// ── GlobalCallListener ──
export function GlobalCallListener() {
  const { user } = useAuth();
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [callBg, setCallBg] = useState('linear-gradient(135deg, #0d0d1a 0%, #1a0026 100%)');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringtoneRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    supabase
      .from('site_settings')
      .select('bg_gradient_from,bg_gradient_to')
      .eq('id', 'main')
      .single()
      .then(({ data }) => {
        if (data) {
          const from = (data as any).bg_gradient_from || '#0d0d1a';
          const to = (data as any).bg_gradient_to || '#1a0026';
          setCallBg(`linear-gradient(135deg, ${from} 0%, ${to} 100%)`);
        }
      });
  }, []);

  useEffect(() => {
    if (!user) return;

    async function checkIncomingCalls() {
      const { data } = await supabase
        .from('calls')
        .select('*, caller:user_profiles!calls_caller_id_fkey(id,username,avatar_url)')
        .eq('callee_id', user!.id)
        .eq('status', 'ringing')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (data && !incomingCall && !activeCall) {
        const caller = (data as any).caller;
        setIncomingCall({
          id: data.id,
          caller: {
            id: caller?.id || data.caller_id,
            username: caller?.username || 'Unknown',
            avatar: caller?.avatar_url,
          },
          callType: data.call_type as 'audio' | 'video',
        });
      }
    }

    pollRef.current = setInterval(checkIncomingCalls, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [user, incomingCall, activeCall]);

  // Ringtone pulse
  useEffect(() => {
    if (incomingCall) {
      ringtoneRef.current = setInterval(() => {
        try {
          const ctx = new AudioContext();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = 880;
          gain.gain.setValueAtTime(0.3, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.5);
        } catch {}
      }, 1200);
    } else {
      if (ringtoneRef.current) clearInterval(ringtoneRef.current);
    }
    return () => {
      if (ringtoneRef.current) clearInterval(ringtoneRef.current);
    };
  }, [incomingCall]);

  const acceptCall = async () => {
    if (!incomingCall || !user) return;
    await supabase
      .from('calls')
      .update({ status: 'active', started_at: new Date().toISOString() })
      .eq('id', incomingCall.id);
    setActiveCall({
      id: incomingCall.id,
      remoteUser: incomingCall.caller,
      callType: incomingCall.callType,
      isInitiator: false,
    });
    setIncomingCall(null);
  };

  const rejectCall = async () => {
    if (!incomingCall) return;
    await supabase
      .from('calls')
      .update({ status: 'ended', ended_at: new Date().toISOString() })
      .eq('id', incomingCall.id);
    setIncomingCall(null);
  };

  if (!incomingCall && !activeCall) return null;

  return (
    <>
      {/* Incoming call overlay */}
      {incomingCall && !activeCall && (
        <div
          className="fixed inset-0 z-[850] flex flex-col items-center justify-between py-16"
          style={{ background: callBg, paddingBottom: 'max(64px, env(safe-area-inset-bottom))' }}
        >
          {/* Pulse rings */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="absolute rounded-full border border-white/20"
                style={{
                  width: `${120 + i * 60}px`,
                  height: `${120 + i * 60}px`,
                  animation: `ping ${1 + i * 0.3}s cubic-bezier(0,0,0.2,1) infinite`,
                  animationDelay: `${i * 0.2}s`,
                  opacity: 0.4 - i * 0.1,
                }}
              />
            ))}
          </div>

          <div className="flex flex-col items-center gap-4 z-10">
            <p className="text-white/60 text-sm">
              Incoming {incomingCall.callType} call
            </p>
            <div className="w-28 h-28 rounded-full overflow-hidden bg-white/10 border-4 border-white/30 flex items-center justify-center">
              {incomingCall.caller.avatar ? (
                <img
                  src={incomingCall.caller.avatar}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-4xl font-black text-white">
                  {(incomingCall.caller.username || '?')[0].toUpperCase()}
                </span>
              )}
            </div>
            <p className="text-white font-black text-2xl">{incomingCall.caller.username}</p>
          </div>

          <div className="flex items-center gap-16 z-10">
            {/* Reject */}
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={rejectCall}
                className="w-16 h-16 rounded-full flex items-center justify-center transition-all active:scale-95"
                style={{ background: '#FF3B30', boxShadow: '0 4px 20px rgba(255,59,48,0.5)' }}
              >
                <PhoneOff className="w-7 h-7 text-white" />
              </button>
              <span className="text-white/60 text-xs">Decline</span>
            </div>

            {/* Accept */}
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={acceptCall}
                className="w-16 h-16 rounded-full flex items-center justify-center transition-all active:scale-95"
                style={{ background: '#34C759', boxShadow: '0 4px 20px rgba(52,199,89,0.5)' }}
              >
                {incomingCall.callType === 'video' ? (
                  <Video className="w-7 h-7 text-white" />
                ) : (
                  <Phone className="w-7 h-7 text-white" />
                )}
              </button>
              <span className="text-white/60 text-xs">Accept</span>
            </div>
          </div>
        </div>
      )}

      {/* Active call screen */}
      {activeCall && user && (
        <ActiveCallScreen
          callId={activeCall.id}
          localUser={{ id: user.id, username: user.username, avatar: user.avatar }}
          remoteUser={activeCall.remoteUser}
          callType={activeCall.callType}
          isInitiator={activeCall.isInitiator}
          callBg={callBg}
          onEnd={() => setActiveCall(null)}
        />
      )}
    </>
  );
}
