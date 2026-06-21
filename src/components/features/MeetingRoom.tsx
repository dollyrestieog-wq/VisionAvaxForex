import React, { useState, useEffect, useRef } from 'react';
import { 
  Mic, MicOff, Video, VideoOff, Monitor, MessageSquare, 
  Users, Hand, MoreVertical, PhoneOff, Settings, Info, 
  Check, Copy, ShieldAlert, Send
} from 'lucide-react';

interface GoogleMeetCallProps {
  meetingCode?: string;
  userName?: string;
  onLeaveMeeting: () => void;
}

export const GoogleMeetCall: React.FC<GoogleMeetCallProps> = ({
  meetingCode = "abc-defg-hij",
  userName = "Wewe (You)",
  onLeaveMeeting
}) => {
  // State za vifaa na UI
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const [hasHandRaised, setHasHandRaised] = useState(false);
  const [activeSidebar, setActiveSidebar] = useState<'none' | 'chat' | 'people' | 'info'>('none');
  const [meetingTime, setMeetingTime] = useState('');
  const [copied, setCopied] = useState(false);
  
  // State za Chat
  const [messages, setMessages] = useState<{sender: string, text: string, time: string}[]>([
    { sender: "Juma Said", text: "Habari za asubuhi timu!", time: "10:32 AM" },
    { sender: "Sarah Kimaro", text: "Mnaweza kuona slide zangu?", time: "10:34 AM" }
  ]);
  const [newMessage, setNewMessage] = useState('');

  // WebRTC Stream Refs
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  // 1. Saa ya Google Meet (Saa halisi ya ukutani juu kuliko muda wa simu)
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setMeetingTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // 2. Kuanzisha Media (Camera & Mic)
  useEffect(() => {
    async function startCamera() {
      try {
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(track => track.stop());
        }

        if (isVideoOn) {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
          });
          localStreamRef.current = stream;
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = stream;
          }
          
          // Zima sauti ikiwa state ya mwanzo ilikuwa muted
          stream.getAudioTracks().forEach(track => track.enabled = !isMuted);
        } else {
          // Kama video imezimwa, chukua sauti tu
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          localStreamRef.current = audioStream;
          audioStream.getAudioTracks().forEach(track => track.enabled = !isMuted);
        }
      } catch (err) {
        console.error("Shida ya kufikia vifaa vya video/sauti:", err);
      }
    }

    startCamera();

    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [isVideoOn]);

  // 3. Mute/Unmute Audio
  const toggleMute = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = isMuted; // Invert track status
      });
      setIsMuted(!isMuted);
    }
  };

  // 4. Screen Sharing Simulation
  const toggleScreenShare = async () => {
    if (!isSharingScreen) {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream;
        }
        setIsSharingScreen(true);
        
        // Hapa inatakiwa kurudi kwenye kamera ya kawaida screen share ikizimwa na mtumiaji kupitia browser bar
        screenStream.getVideoTracks()[0].onended = () => {
          setIsSharingScreen(false);
          setIsVideoOn(false); // trigger re-render ya camera
          setIsVideoOn(true);
        };
      } catch (e) {
        console.error("Imeshindwa kushare kioo:", e);
      }
    } else {
      setIsSharingScreen(false);
      setIsVideoOn(false);
      setIsVideoOn(true);
    }
  };

  // 5. Nakili Code ya Kikao (Copy Link)
  const copyMeetingLink = () => {
    navigator.clipboard.writeText(`
