; rcloneGUI NSIS 사용자 정의 (electron-builder.yml nsis.include)
; 제거할 때(업데이트 설치가 아닐 때만) 앱이 등록한 로그인 시 시작 항목을 지운다.
; 값 이름은 src/main/index.ts의 APP_USER_MODEL_ID(setLoginItemSettings name)와 같아야 한다.
; Windows 작업 스케줄러의 \rcloneGUI\ 폴더(OS 예약, INT-003 T-01)도 작업과 빈 폴더까지 지운다(업데이트 설치가 아닐 때만).
;   상수 문자열만 쓰고(사용자 입력 없음), 실패해도 제거를 막지 않는다. 다시 설치하면 첫 실행 때 앱이 예약을 다시 등록한다.
; 사용자 데이터(%APPDATA%\rcloneGUI)는 지우지 않는다(deleteAppDataOnUninstall: false).

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.rclonegui.app"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.rclonegui.app"
    nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$s=New-Object -ComObject Schedule.Service;$$s.Connect();try{$$f=$$s.GetFolder('\rcloneGUI')}catch{exit 0};foreach($$t in @($$f.GetTasks(1))){try{$$f.DeleteTask($$t.Name,0)}catch{}};try{$$s.GetFolder('\').DeleteFolder('rcloneGUI',0)}catch{}"`
    Pop $0
  ${endIf}
!macroend
