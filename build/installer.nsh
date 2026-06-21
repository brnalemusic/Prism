Var /GLOBAL installerText

!macro customHeader
  !ifdef LANG_ENGLISH
    LangString installing ${LANG_ENGLISH} "$installerText"
  !endif
  !ifdef LANG_PORTUGUESE
    LangString installing ${LANG_PORTUGUESE} "$installerText"
  !endif
  !ifdef LANG_PORTUGUESEBR
    LangString installing ${LANG_PORTUGUESEBR} "$installerText"
  !endif
  !ifdef LANG_SPANISH
    LangString installing ${LANG_SPANISH} "$installerText"
  !endif
  !ifdef LANG_FRENCH
    LangString installing ${LANG_FRENCH} "$installerText"
  !endif
  !ifdef LANG_GERMAN
    LangString installing ${LANG_GERMAN} "$installerText"
  !endif
  !ifdef LANG_ITALIAN
    LangString installing ${LANG_ITALIAN} "$installerText"
  !endif
  !ifdef LANG_JAPANESE
    LangString installing ${LANG_JAPANESE} "$installerText"
  !endif
  !ifdef LANG_KOREAN
    LangString installing ${LANG_KOREAN} "$installerText"
  !endif
  !ifdef LANG_RUSSIAN
    LangString installing ${LANG_RUSSIAN} "$installerText"
  !endif
  !ifdef LANG_CHINESE
    LangString installing ${LANG_CHINESE} "$installerText"
  !endif
  !ifdef LANG_SIMPCHINESE
    LangString installing ${LANG_SIMPCHINESE} "$installerText"
  !endif
  !ifdef LANG_TRADCHINESE
    LangString installing ${LANG_TRADCHINESE} "$installerText"
  !endif
  !ifdef LANG_DUTCH
    LangString installing ${LANG_DUTCH} "$installerText"
  !endif
  !ifdef LANG_SWEDISH
    LangString installing ${LANG_SWEDISH} "$installerText"
  !endif
  !ifdef LANG_NORWEGIAN
    LangString installing ${LANG_NORWEGIAN} "$installerText"
  !endif
  !ifdef LANG_DANISH
    LangString installing ${LANG_DANISH} "$installerText"
  !endif
  !ifdef LANG_FINNISH
    LangString installing ${LANG_FINNISH} "$installerText"
  !endif
  !ifdef LANG_TURKISH
    LangString installing ${LANG_TURKISH} "$installerText"
  !endif
  !ifdef LANG_POLISH
    LangString installing ${LANG_POLISH} "$installerText"
  !endif
  !ifdef LANG_CZECH
    LangString installing ${LANG_CZECH} "$installerText"
  !endif
  !ifdef LANG_SLOVAK
    LangString installing ${LANG_SLOVAK} "$installerText"
  !endif
  !ifdef LANG_HUNGARIAN
    LangString installing ${LANG_HUNGARIAN} "$installerText"
  !endif
!macroend

!macro customInit
  SetSilent normal

  # Check if it's an update and set the status text accordingly
  ${if} ${isUpdated}
    StrCpy $installerText "Updating Prism"
  ${else}
    StrCpy $installerText "Downloading Prism"
  ${endif}
!macroend
