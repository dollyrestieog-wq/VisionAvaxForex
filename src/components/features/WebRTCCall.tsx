<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WebRTC Local Loopback Demo</title>
    <style>
        body { font-family: sans-serif; max-width: 800px; margin: 20px auto; padding: 0 20px; }
        .video-container { display: flex; gap: 20px; margin-bottom: 20px; }
        video { width: 45%; background: #222; border-radius: 8px; transform: scaleX(-1); }
        .controls { margin-bottom: 20px; }
        button { padding: 10px 20px; font-size: 16px; cursor: pointer; margin-right: 10px; }
        button:disabled { cursor: not-allowed; opacity: 0.5; }
        #log { background: #eee; padding: 10px; border-radius: 4px; height: 150px; overflow-y: auto; font-family: monospace; font-size: 12px; }
    </style>
</head>
<body>

    <h1>WebRTC Full Implementation Demo</h1>
    
    <div class="video-container">
        <div>
            <h3>Local Video (Caller)</h3>
            <video id="localVideo" autoplay playsinline muted></video>
        </div>
        <div>
            <h3>Remote Video (Callee)</h3>
            <video id="remoteVideo" autoplay playsinline></video>
        </div>
    </div>

    <div class="controls">
        <button id="startButton">1. Start Camera</button>
        <button id="callButton" disabled>2. Call</button>
        <button id="hangupButton" disabled>3. Hang Up</button>
    </div>

    <h3>Signaling & Connection Log</h3>
    <div id="log"></div>

    <script>
        // UI Elements
        const startButton = document.getElementById('startButton');
        const callButton = document.getElementById('callButton');
        const hangupButton = document.getElementById('hangupButton');
        const localVideo = document.getElementById('localVideo');
        const remoteVideo = document.getElementById('remoteVideo');
        const logDiv = document.getElementById('log');

        // WebRTC Global Variables
        let localStream;
        let pc1; // Caller PeerConnection
        let pc2; // Callee PeerConnection

        // STUN Servers configuration for NAT traversal
        const rtcConfig = {
            iceServers: [
                { urls: 'stun:://google.com' },
                { urls: 'stun:://google.com' }
            ]
        };

        // Event Listeners
        startButton.onclick = startMedia;
        callButton.onclick = makeCall;
        hangupButton.onclick = hangUp;

        function log(message) {
            logDiv.innerHTML += `[${new Date().toLocaleTimeString()}] ${message}<br>`;
            logDiv.scrollTop = logDiv.scrollHeight;
        }

        // Step 1: Access local camera and microphone
        async function startMedia() {
            try {
                log('Requesting local media stream...');
                localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                localVideo.srcObject = localStream;
                log('Local stream received and assigned to video element.');
                startButton.disabled = true;
                callButton.disabled = false;
            } catch (e) {
                log(`ERROR accessing media devices: ${e.message}`);
            }
        }

        // Step 2: Establish connection and simulate signaling
        async function makeCall() {
            callButton.disabled = true;
            hangupButton.disabled = false;
            log('Starting WebRTC connection setup.');

            // 1. Create Peer Connections
            pc1 = new RTCPeerConnection(rtcConfig);
            log('Created local peer connection object (pc1).');
            
            pc2 = new RTCPeerConnection(rtcConfig);
            log('Created remote peer connection object (pc2).');

            // 2. Setup ICE Candidate exchanges (Simulating signaling server)
            pc1.onicecandidate = async (event) => {
                if (event.candidate) {
                    log('pc1 generated ICE candidate. Sending to pc2...');
                    try {
                        await pc2.addIceCandidate(event.candidate);
                    } catch (e) { log(`Error adding ICE to pc2: ${e.toString()}`); }
                }
            };

            pc2.onicecandidate = async (event) => {
                if (event.candidate) {
                    log('pc2 generated ICE candidate. Sending to pc1...');
                    try {
                        await pc1.addIceCandidate(event.candidate);
                    } catch (e) { log(`Error adding ICE to pc1: ${e.toString()}`); }
                }
            };

            // 3. Handle incoming remote media stream on the receiver side
            pc2.ontrack = (event) => {
                log('pc2 received remote media track.');
                if (remoteVideo.srcObject !== event.streams[0]) {
                    remoteVideo.srcObject = event.streams[0];
                    log('Assigned remote stream to remote video element.');
                }
            };

            // 4. Add local tracks to caller connection
            localStream.getTracks().forEach(track => pc1.addTrack(track, localStream));
            log('Added local media tracks to pc1.');

            try {
                // 5. Create Offer (Caller)
                log('pc1 creating cryptographic connection offer (SDP)...');
                const offer = await pc1.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
                
                log('pc1 setting local description.');
                await pc1.setLocalDescription(offer);
                
                // --- Signaling Message Transmitted ---
                log('pc2 setting remote description (receiving pc1 offer).');
                await pc2.setLocalDescription(await pc2.createAnswer() ? offer : offer); // standard assignment
                await pc2.setRemoteDescription(offer);

                // 6. Create Answer (Callee)
                log('pc2 creating connection answer (SDP)...');
                const answer = await pc2.createAnswer();
                
                log('pc2 setting local description.');
                await pc2.setLocalDescription(answer);
                
                // --- Signaling Message Transmitted ---
                log('pc1 setting remote description (receiving pc2 answer).');
                await pc1.setRemoteDescription(answer);

                log('SDP Negotiation Handshake Complete.');
            } catch (e) {
                log(`Negotiation failed: ${e.toString()}`);
            }
        }

        // Step 3: Clean up and close connections
        function hangUp() {
            log('Closing call connections.');
            if (pc1) pc1.close();
            if (pc2) pc2.close();
            pc1 = null;
            pc2 = null;
            
            // Clear remote video source
            remoteVideo.srcObject = null;
            
            hangupButton.disabled = true;
            callButton.disabled = false;
            log('Call ended.');
        }
    </script>
</body>
</html>
