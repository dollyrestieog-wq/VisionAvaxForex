import React, { useState, useEffect, useRef } from 'react';
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff, Volume2, VolumeX, Maximize2, Minimize2 } from 'lucide-react';

interface WebRTCCallProps {
  callerName: string;
  callerAvatarUrl?: string;
  isVideoCallInitial?: boolean;
  onHangUp: () => void;
}

export const WebRTCCall: React.FC<WebRTCCallProps> = ({
  callerName,
  callerAvatarUrl = "https://unsplash.com",
  isVideoCallInitial = true,
  onHangUp
}) => {
  // State management kufuatilia mtiririko kama WhatsApp/Telegram
  const [callState, setCallState] = useState<'calling' | 'connected' | 'disconnected'>('calling');
  const [isVideoOn, setIsVideoOn] = useState(isVideoCallInitial);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [callDuration, setCallDuration] = useState(0);

  // WebRTC Stream Refs
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);

  // 1. Kuhesabu muda wa simu (Call Timer) kama Telegram
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (callState === 'connected') {
      timer = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [callState]);

  // 2. Kuanzisha Media (Camera/Microphone) na WebRTC
  useEffect(() => {
    async function setupMediaAndConnection() {
      try {
        // Omba ruhusa ya sauti na video
        const stream = await navigator.mediaDevices.getUserMedia({
          video: isVideoOn,
          audio: true
        });
        
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        // Simulating receiving the call for demo purposes after 3 seconds
        // Kwenye application halisi, hapa utatumia Signaling Server (WebSockets)
        setTimeout(() => {
          setCallState('connected');
          // Hapa ungeunganisha RTCPeerConnection na kuanza ku-stream remote video
        }, 3000);

      } catch (error) {
        console.error("Ufikiaji wa kamera/kipaza sauti umekataliwa:", error);
      }
    }

    setupMediaAndConnection();

    return () => {
      // Clean up streams wakati component inafungwa
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
    };
  }, []);

  // 3. Format Muda (00:00)
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // 4. Kuzuia/Kuruhusu Sauti (Mute/Unmute)
  const toggleMute = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  // 5. Washa/Zima Video wakati wa simu
  const toggleVideo = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsVideoOn(!isVideoOn);
    }
  };

  // 6. Kukata Simu
  const handleDisconnect = () => {
    setCallState('disconnected');
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
    }
    onHangUp();
  };

  return (
    <div className={`relative flex flex-col justify-between items-center bg-zinc-950 text-white transition-all duration-300 overflow-hidden ${isFullScreen ? 'fixed inset-0 z-50 w-screen h-screen' : 'w-full max-w-md h-[680px] rounded-3xl shadow-2xl border border-zinc-800'}`}>
      
      {/* BACKGROUND BLUR EFFECT (Telegram Style) */}
      {!isVideoOn && (
        <div className="absolute inset-0 opacity-20 bg-cover bg-center blur-3xl scale-110 pointer-events-none" style={{ backgroundImage: `url(${callerAvatarUrl})` }} />
      )}

      {/* TOP BAR: Muonekano wa Juu */}
      <div className="w-full z-10 p-5 flex justify-between items-center bg-gradient-to-b from-black/50 to-transparent">
        <div className="flex items-center gap-2 bg-black/30 backdrop-blur-md px-3 py-1.5 rounded-full text-xs text-zinc-300 border border-white/5">
          <span className={`w-2 h-2 rounded-full ${callState === 'connected' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500 animate-bounce'}`} />
          {callState === 'calling' ? 'Inapiga...' : 'Mmeunganishwa'}
        </div>
        
        <button onClick={() => setIsFullScreen(!isFullScreen)} className="p-2 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 transition backdrop-blur-md">
          {isFullScreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
      </div>

      {/* MIDDLE SECTION: Sehemu ya Kati (Avatar au Video) */}
      <div className="w-full flex-1 flex flex-col justify-center items-center relative px-6">
        
        {/* UKIWA KWENYE AUDIO CALL AU VIDEO IMEZIMWA (Telegram Style) */}
        {!isVideoOn ? (
          <div className="flex flex-col items-center z-10">
            <div className="relative mb-6">
              {/* Ripple Ring Animation ya Telegram */}
              <div className="absolute inset-0 rounded-full bg-indigo-500/20 animate-ping" />
              <img src={callerAvatarUrl} alt={callerName} className="w-32 h-32 rounded-full object-cover border-4 border-zinc-800 shadow-xl relative z-10" />
            </div>
            <h2 className="text-2xl font-bold tracking-wide drop-shadow-md">{callerName}</h2>
            <p className="text-zinc-400 mt-2 font-medium text-sm">
              {callState === 'calling' ? 'Telegram Audio Call' : formatTime(callDuration)}
            </p>
          </div>
        ) : (
          /* UKIWA KWENYE VIDEO CALL (WhatsApp Style) */
          <div className="absolute inset-0 w-full h-full bg-black">
            {/* Remote Video (Mtu mwingine - Fullscreen) */}
            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
            
            {/* Kama hakuna remote stream bado, onyesha loading avatar ya mbali */}
            {callState === 'calling' && (
              <div className="absolute inset-0 flex flex-col justify-center items-center bg-zinc-900/90">
                <img src={callerAvatarUrl} alt={callerName} className="w-24 h-24 rounded-full object-cover animate-pulse border-2 border-white/20 mb-4" />
                <p className="text-lg font-medium">{callerName}</p>
                <p className="text-xs text-zinc-400 mt-1">Inatafuta mtandao...</p>
              </div>
            )}

            {/* Local Video (Kamera yako - Mali ya Mbele ndogo iliyopo kona) */}
            <div className="absolute top-4 right-4 w-28 h-40 rounded-xl overflow-hidden border border-white/20 shadow-2xl bg-zinc-900 transition-all z-20">
              <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover transform scale-x-[-1]" />
            </div>
          </div>
        )}
      </div>

      {/* BOTTOM ACTIONS BAR: Vidude vya Kudhibiti chini (WhatsApp/Telegram Floating Grid) */}
      <div className="w-full z-10 p-6 bg-gradient-to-t from-black/80 via-black/40 to-transparent flex flex-col items-center gap-6">
        
        {/* Vidhibiti vya Ziada vikiwa vimejificha juu kidogo ya kitufe cha kukata */}
        <div className="flex items-center justify-center gap-6 bg-zinc-900/60 backdrop-blur-xl px-6 py-3 rounded-full border border-white/5 w-fit">
          {/* Speaker Button */}
          <button onClick={() => setIsSpeakerOn(!isSpeakerOn)} className={`p-3 rounded-full transition-all active:scale-90 ${isSpeakerOn ? 'text-indigo-400 bg-indigo-500/10' : 'text-zinc-400 hover:text-white'}`}>
            {isSpeakerOn ? <Volume2 size={22} /> : <VolumeX size={22} />}
          </button>

          {/* Video Toggle Button */}
          <button onClick={toggleVideo} className={`p-3 rounded-full transition-all active:scale-90 ${isVideoOn ? 'text-emerald-400 bg-emerald-500/10' : 'text-zinc-400 hover:text-white'}`}>
            {isVideoOn ? <Video size={22} /> : <VideoOff size={22} />}
          </button>

          {/* Microphone Mute Button */}
          <button onClick={toggleMute} className={`p-3 rounded-full transition-all active:scale-90 ${isMuted ? 'text-rose-400 bg-rose-500/10' : 'text-zinc-400 hover:text-white'}`}>
            {isMuted ? <MicOff size={22} /> : <Mic size={22} />}
          </button>
        </div>

        {/* Big Red End Call Button */}
        <button onClick={handleDisconnect} className="w-16 h-16 rounded-full bg-rose-600 hover:bg-rose-500 active:scale-90 flex justify-center items-center shadow-lg shadow-rose-900/40 transition-all border border-rose-500/30 transform hover:rotate-135 duration-300">
          <PhoneOff size={28} className="text-white" />
        </button>
      </div>
    </div>
  );
};
