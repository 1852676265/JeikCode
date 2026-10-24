!macro NSIS_HOOK_POSTINSTALL
  ; Re-create desktop shortcut explicitly with executable icon index 0
  CreateShortCut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\${MAINBINARYNAME}.exe" 0
  ; Refresh shell icon cache so existing cached placeholders/icons are cleared
  System::Call 'shell32.dll::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'

  ; Register $INSTDIR into user PATH environment variable (idempotent, official install standard)
  ReadRegStr $0 HKCU "Environment" "Path"
  ${If} $0 == ""
    WriteRegExpandStr HKCU "Environment" "Path" "$INSTDIR"
    SendMessage ${HWND_BROADCAST} 0x001A 0 "STR:Environment" /TIMEOUT=5000
  ${Else}
    ; Append $INSTDIR if not already present
    Push "$0"
    Push "$INSTDIR"
    Call StrStr
    Pop $1
    ${If} $1 == ""
      WriteRegExpandStr HKCU "Environment" "Path" "$INSTDIR;$0"
      SendMessage ${HWND_BROADCAST} 0x001A 0 "STR:Environment" /TIMEOUT=5000
    ${EndIf}
  ${EndIf}

  ; Clean up legacy ~/.local/bin/jeikcode.exe if left by older dropper versions
  IfFileExists "$PROFILE\.local\bin\jeikcode.exe" 0 +2
    Delete "$PROFILE\.local\bin\jeikcode.exe"
!macroend

!macro NSIS_HOOK_UNINSTALL
  ; Clean up desktop shortcut
  Delete "$DESKTOP\${PRODUCTNAME}.lnk"
  ; Refresh shell icon cache
  System::Call 'shell32.dll::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
