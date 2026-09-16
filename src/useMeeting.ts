import { useEffect, useState, useSyncExternalStore } from 'react';
import { MeetingController } from './meeting';

export function useMeeting() {
  const [controller] = useState(() => new MeetingController());
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => {
    const onPageHide = () => controller.dispose();
    window.addEventListener('pagehide', onPageHide);
    return () => { window.removeEventListener('pagehide', onPageHide); controller.dispose(); };
  }, [controller]);
  return {
    snapshot,
    prepareMedia: controller.prepareMedia,
    toggleAudio: controller.toggleAudio,
    toggleVideo: controller.toggleVideo,
    join: controller.join,
    leave: controller.leave,
    reset: controller.reset,
    copyInvite: controller.copyInvite,
    retryConnection: controller.retryConnection,
  };
}
