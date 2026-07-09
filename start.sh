#!/bin/bash
cd /home/mobta/Black_Mic

# Start the Node server in the background if it's not already running
if ! pgrep -f "node server.js" > /dev/null; then
    node server.js &
fi

# Every time the phone is replugged, the ADB USB bridge breaks.
# This command forces it back open.
adb reverse tcp:3001 tcp:3001

# Open the app in the default web browser on PC
xdg-open http://localhost:3001
