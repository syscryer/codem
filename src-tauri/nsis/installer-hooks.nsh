!macro NSIS_HOOK_PREINSTALL
  IfFileExists "$INSTDIR\codem-agent-mux.exe" 0 +2
    ExecWait '"$INSTDIR\codem-agent-mux.exe" stop'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  IfFileExists "$INSTDIR\codem-agent-mux.exe" 0 +2
    ExecWait '"$INSTDIR\codem-agent-mux.exe" stop'
!macroend
