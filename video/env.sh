export PYTHONPATH=/workspace/work/hwpy
export FONTCONFIG_FILE=/workspace/work/hwdeb/fc/fonts.conf
if [ -x /usr/bin/chromium ]; then export HW_CHROME=/usr/bin/chromium; else export HW_CHROME=/workspace/work/hwdeb/root/usr/lib/chromium/chromium-headless-shell; fi
cd /workspace/work/hackathons/eurekadev/video
