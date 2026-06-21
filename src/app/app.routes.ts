import { Routes } from '@angular/router';
import { VideoChatComponent } from './video-chat/video-chat.component';

export const routes: Routes = [
    { path: 'video-chat', component: VideoChatComponent },
    { path: '', redirectTo: 'video-chat', pathMatch: 'full' }
];
