!macro customHeader
  SilentInstall silent
  SilentUnInstall silent
!macroend

!macro customInit
  SetSilent silent
!macroend

!macro customInstall
  DetailPrint "Checking and installing browser dependencies..."
  ExecWait '"$INSTDIR\Prism.exe" --install-playwright-browsers'
!macroend
