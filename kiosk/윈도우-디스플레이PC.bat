@echo off
rem ── 디스플레이 PC 원클릭 실행 (Windows) ── URL만 배포 주소로 바꿔주세요.
set URL=https://배포주소.vercel.app/world.html
start chrome --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble --incognito %URL%
