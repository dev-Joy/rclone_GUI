; rcloneGUI NSIS 사용자 정의 (electron-builder.yml nsis.include)
; 제거할 때(업데이트 설치가 아닐 때만) 앱이 등록한 로그인 시 시작 항목을 지운다.
; 값 이름은 src/main/index.ts의 APP_USER_MODEL_ID(setLoginItemSettings name)와 같아야 한다.
; 사용자 데이터(%APPDATA%\rcloneGUI)는 지우지 않는다(deleteAppDataOnUninstall: false).

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.rclonegui.app"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.rclonegui.app"
  ${endIf}
!macroend
