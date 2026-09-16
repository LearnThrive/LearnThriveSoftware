import { useEffect, useRef, type RefObject } from 'react';
import type { DeviceOption } from '../media';
import { Icon } from './Icon';

interface DeviceMenuProps {
  open: boolean;
  onClose: () => void;
  cameras: DeviceOption[];
  microphones: DeviceOption[];
  selectedCamera: string | undefined;
  selectedMicrophone: string | undefined;
  onSelectCamera: (deviceId: string) => void;
  onSelectMicrophone: (deviceId: string) => void;
  canFlip: boolean;
  onFlip: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

export function DeviceMenu({
  open, onClose, cameras, microphones, selectedCamera, selectedMicrophone, onSelectCamera, onSelectMicrophone, canFlip, onFlip, triggerRef,
}: DeviceMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Escape is a pure keyboard dismissal, so focus returns to the trigger. A click outside
    // already tells us where the user wants focus (wherever they clicked), so that path leaves
    // focus alone rather than yanking it back.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      onClose();
      triggerRef.current?.focus();
    };
    const onClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onClickOutside);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('mousedown', onClickOutside); };
  }, [open, onClose, triggerRef]);

  if (!open) return null;

  return (
    <div className="device-menu" ref={menuRef} role="menu" aria-label="Camera and microphone options">
      <div className="device-menu-group">
        <label htmlFor="camera-select">Camera</label>
        <select id="camera-select" value={selectedCamera ?? ''} onChange={(event) => onSelectCamera(event.target.value)}>
          <option value="" disabled hidden>{cameras.length === 0 ? 'No cameras found' : 'Default'}</option>
          {cameras.map((camera) => <option key={camera.deviceId} value={camera.deviceId}>{camera.label}</option>)}
        </select>
      </div>
      <div className="device-menu-group">
        <label htmlFor="microphone-select">Microphone</label>
        <select id="microphone-select" value={selectedMicrophone ?? ''} onChange={(event) => onSelectMicrophone(event.target.value)}>
          <option value="" disabled hidden>{microphones.length === 0 ? 'No microphones found' : 'Default'}</option>
          {microphones.map((mic) => <option key={mic.deviceId} value={mic.deviceId}>{mic.label}</option>)}
        </select>
      </div>
      {canFlip && <button type="button" className="device-menu-flip" onClick={onFlip}><Icon name="flip" size={16} />Switch front/rear camera</button>}
    </div>
  );
}
