!macro customInstall
  DetailPrint "Checking and installing browser dependencies..."
  ExecWait '"$INSTDIR\Prism.exe" --install-playwright-browsers'
!macroend
