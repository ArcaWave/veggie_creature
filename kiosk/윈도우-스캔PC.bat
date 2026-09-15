@echo off
rem ── 스캔 PC 원클릭 실행 (Windows) ── URL만 배포 주소로 바꿔주세요.
rem 카메라 권한 기억을 위해 시크릿 모드는 쓰지 않습니다.
set URL=https://배포주소.vercel.app/
start chrome --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble %URL%
