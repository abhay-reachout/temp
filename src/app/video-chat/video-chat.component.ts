import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SignalRService } from '../core/services/signal-r.service';

@Component({
  selector: 'app-video-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './video-chat.component.html'
})
export class VideoChatComponent implements OnInit, OnDestroy {

  @ViewChild('localVideo') localVideo!: ElementRef<HTMLVideoElement>;
  @ViewChild('remoteVideo') remoteVideo!: ElementRef<HTMLVideoElement>;

  status = 'Idle';
  roomId = '';
  isInitiator = false;

  localStream: MediaStream | null = null;
  peerConnection: RTCPeerConnection | null = null;
  private remoteStream = new MediaStream();

  chatMessages: { fromMe: boolean; text: string }[] = [];
  chatInput = '';

  private readonly rtcConfig: RTCConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  constructor(private signalR: SignalRService) {}

  async ngOnInit() {
    await this.signalR.startConnection();
    this.registerHubEvents();
    this.status = 'Connected to server';
  }

  ngOnDestroy() {
    this.signalR.disconnect();
    this.localStream?.getTracks().forEach(t => t.stop());
    this.peerConnection?.close();
  }

  // ── User clicks Start ──────────────────────────────────────────
  async startChat() {
    this.status = 'Getting camera...';
    await this.startLocalCamera();

    this.status = 'Looking for a partner...';
    await this.signalR.invoke('FindPartner');
  }

  // ── SignalR event registration ─────────────────────────────────
  private registerHubEvents() {
    this.signalR.on('Waiting', () => {
      this.status = 'Waiting for a partner...';
    });

    this.signalR.on('StartCall', async (roomId: string) => {
      this.roomId = roomId;
      this.isInitiator = true;
      this.status = 'Partner found — connecting...';
      this.setupPeerConnection();
      await this.createAndSendOffer();
    });

    this.signalR.on('IncomingCall', (roomId: string) => {
      this.roomId = roomId;
      this.isInitiator = false;
      this.status = 'Partner found — connecting...';
      this.setupPeerConnection();
      // Wait for ReceiveOffer — answer is created there
    });

    this.signalR.on('ReceiveOffer', async (sdp: string) => {
      await this.handleReceivedOffer(sdp);
    });

    this.signalR.on('ReceiveAnswer', async (sdp: string) => {
      await this.handleReceivedAnswer(sdp);
    });

    this.signalR.on('ReceiveIceCandidate', async (candidate: string) => {
      if (!this.peerConnection) return;
      try {
        const parsed = JSON.parse(candidate);
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(parsed));
      } catch (err) {
        console.error('Failed to add ICE candidate', err);
      }
    });

    this.signalR.on('ReceiveMessage', (message: string) => {
      this.chatMessages.push({ fromMe: false, text: message });
    });

    this.signalR.on('PartnerLeft', () => {
      this.status = 'Partner left';
      this.peerConnection?.close();
      this.peerConnection = null;
    });

    this.signalR.on('Error', (code: string, message: string) => {
      console.error('Hub error:', code, message);
      this.status = `Error: ${message}`;
    });
  }

  // ── Camera setup ────────────────────────────────────────────────
  private async startLocalCamera() {
    this.localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });

    // Element exists in DOM unconditionally (see HTML) so this is always safe
    this.localVideo.nativeElement.srcObject = this.localStream;
  }

  // ── PeerConnection setup ───────────────────────────────────────
  private setupPeerConnection() {
    this.peerConnection = new RTCPeerConnection(this.rtcConfig);

    // Reset remote stream for the new connection
    this.remoteStream = new MediaStream();
    this.remoteVideo.nativeElement.srcObject = this.remoteStream;

    // Add our local tracks
    this.localStream?.getTracks().forEach(track => {
      this.peerConnection!.addTrack(track, this.localStream!);
    });

    // Receive remote tracks — fires once per track (audio, video)
    // We add each to the SAME MediaStream instance instead of reassigning srcObject
    this.peerConnection.ontrack = (event) => {
      this.remoteStream.addTrack(event.track);
    };

    // Send each ICE candidate as it's discovered (trickle ICE — faster connections)
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.roomId) {
        this.signalR.invoke(
          'SendIceCandidate',
          this.roomId,
          JSON.stringify(event.candidate)
        );
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      if (this.peerConnection?.connectionState === 'connected') {
        this.status = 'Connected';
      }
    };
  }

  // ── Offer / Answer flow ────────────────────────────────────────
  private async createAndSendOffer() {
    if (!this.peerConnection) return;

    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);

    // setLocalDescription resolves only once the description is actually set —
    // localDescription is guaranteed non-null right here, no need to wait for
    // full ICE gathering before sending (trickle ICE handles candidates separately)
    await this.signalR.invoke(
      'SendOffer',
      this.roomId,
      JSON.stringify(this.peerConnection.localDescription)
    );
  }

  private async handleReceivedOffer(sdp: string) {
    if (!this.peerConnection) return;

    const remoteDesc = JSON.parse(sdp);
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(remoteDesc));

    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);

    await this.signalR.invoke(
      'SendAnswer',
      this.roomId,
      JSON.stringify(this.peerConnection.localDescription)
    );
  }

  private async handleReceivedAnswer(sdp: string) {
    if (!this.peerConnection) return;

    const remoteDesc = JSON.parse(sdp);
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(remoteDesc));
  }

  // ── Chat ────────────────────────────────────────────────────────
  async sendMessage() {
    if (!this.chatInput.trim() || !this.roomId) return;

    await this.signalR.invoke('SendMessage', this.roomId, this.chatInput);
    this.chatMessages.push({ fromMe: true, text: this.chatInput });
    this.chatInput = '';
  }
}