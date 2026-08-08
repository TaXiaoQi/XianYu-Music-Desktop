import { tauriInvoke } from './invoke';

export const recognizeApi = {
  recognizeSystemAudio: () => tauriInvoke('recognize_system_audio'),
  cancelRecognizeSystemAudio: () => tauriInvoke('cancel_recognize_system_audio'),
};
