import React from 'react';

const USB_LABELS = {
  device: { text: 'USB phone ready', className: 'usb-pill usb-pill--ok' },
  unauthorized: { text: 'USB: tap Allow on phone', className: 'usb-pill usb-pill--warn' },
  none: { text: 'USB: no phone', className: 'usb-pill usb-pill--warn' },
  missing: { text: 'USB: adb missing', className: 'usb-pill usb-pill--bad' },
};

export default function ConsoleHeader({ role, roomId, usbStatus }) {
  const usb = usbStatus ? USB_LABELS[usbStatus.state] || USB_LABELS.missing : null;

  return (
    <div className="console-header">
      <h1 className="title">{role === 'sender' ? 'Broadcasting Console' : 'Studio Monitor'}</h1>
      <div className="console-header-pills">
        {usb && (
          <div className={usb.className} title="ADB device state reported by /usb-status">
            {usb.text}
          </div>
        )}
        <div className="room-pill">
          <span>ROOM:</span>
          <strong>{roomId}</strong>
        </div>
      </div>
    </div>
  );
}
