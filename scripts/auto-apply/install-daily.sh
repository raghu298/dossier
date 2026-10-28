#!/bin/zsh
# Makes Dossier start on login and runs the auto-apply every day at 08:45.
# Undo: launchctl unload ~/Library/LaunchAgents/com.raghunath.dossier*.plist && rm ~/Library/LaunchAgents/com.raghunath.dossier*.plist
set -e
LA=~/Library/LaunchAgents
mkdir -p $LA
cat > $LA/com.raghunath.dossier.plist <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.raghunath.dossier</string>
<key>ProgramArguments</key><array><string>/bin/zsh</string><string>-c</string><string>export PATH=/Users/raghunath/.nvm/versions/node/v24.14.1/bin:/usr/bin:/bin; exec /Users/raghunath/dossier-data/start-dossier.sh</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>/Users/raghunath/dossier-data/server.log</string>
<key>StandardErrorPath</key><string>/Users/raghunath/dossier-data/server.log</string>
</dict></plist>
EOF
cat > $LA/com.raghunath.dossier-autoapply.plist <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.raghunath.dossier-autoapply</string>
<key>ProgramArguments</key><array><string>/bin/zsh</string><string>/Users/raghunath/dossier-data/run-auto-apply.sh</string></array>
<key>StartCalendarInterval</key><dict><key>Hour</key><integer>8</integer><key>Minute</key><integer>45</integer></dict>
<key>StandardOutPath</key><string>/Users/raghunath/dossier-data/auto-apply.log</string>
<key>StandardErrorPath</key><string>/Users/raghunath/dossier-data/auto-apply.log</string>
</dict></plist>
EOF
# Stop a Dossier started by hand so the login one can take port 3000.
pkill -f ".next/standalone/server.js" || true
launchctl unload $LA/com.raghunath.dossier.plist 2>/dev/null || true
launchctl unload $LA/com.raghunath.dossier-autoapply.plist 2>/dev/null || true
launchctl load $LA/com.raghunath.dossier.plist
launchctl load $LA/com.raghunath.dossier-autoapply.plist
echo "Installed: Dossier starts on login; auto-apply runs daily at 08:45 (log: ~/dossier-data/auto-apply.log)."
