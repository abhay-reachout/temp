import { Injectable } from '@angular/core';
import { HubConnection, HubConnectionBuilder, LogLevel } from '@microsoft/signalr';

@Injectable({ providedIn: 'root' })
export class SignalRService {
  private hubConnection!: HubConnection;
  private readonly hubUrl = 'http://138.252.100.148:8126/hub/v1'; // adjust to your backend URL

  async startConnection(): Promise<void> {
    this.hubConnection = new HubConnectionBuilder()
      .withUrl(this.hubUrl)
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Information)
      .build();

    await this.hubConnection.start();
  }

  on(eventName: string, callback: (...args: any[]) => void): void {
    this.hubConnection.on(eventName, callback);
  }

  invoke(methodName: string, ...args: any[]): Promise<void> {
    return this.hubConnection.invoke(methodName, ...args);
  }

  disconnect(): void {
    this.hubConnection?.stop();
  }
}