; Define StrStr helper for searching needle ($INSTDIR) in haystack (Path)
!ifndef STRSTR_FUNCTION_DEFINED
!define STRSTR_FUNCTION_DEFINED
Function StrStr
  Exch $R1 ; $R1 = needle
  Exch     ; swap $R1 and haystack
  Exch $R2 ; $R2 = haystack
  Push $R3
  Push $R4
  Push $R5
  StrLen $R3 $R1
  StrCpy $R4 0
loop:
  StrCpy $R5 $R2 $R3 $R4
  StrCmp $R5 $R1 done
  StrCmp $R5 "" done
  IntOp $R4 $R4 + 1
  Goto loop
done:
  StrCpy $R1 $R2 "" $R4
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Exch $R1
FunctionEnd
!endif

!macro NSIS_HOOK_PREINSTALL
  ; Terminate any existing running instances of desktop or daemon before extracting/overwriting files
  nsExec::Exec 'taskkill /F /IM "jeikcode-desktop.exe" /T'
  nsExec::Exec 'taskkill /F /IM "jeikcode.exe" /T'
  Sleep 600
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Re-create desktop shortcut explicitly with executable icon index 0
  CreateShortCut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\${MAINBINARYNAME}.exe" 0
  ; Refresh shell icon cache so existing cached placeholders/icons are cleared
  System::Call 'shell32.dll::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'

  ; Register $INSTDIR and $INSTDIR\resources into user PATH environment variable
  ReadRegStr $0 HKCU "Environment" "Path"
  ${If} $0 == ""
    WriteRegExpandStr HKCU "Environment" "Path" "$INSTDIR\resources;$INSTDIR"
    SendMessage ${HWND_BROADCAST} 0x001A 0 "STR:Environment" /TIMEOUT=5000
  ${Else}
    ; Append $INSTDIR\resources if not already present
    Push "$0"
    Push "$INSTDIR\resources"
    Call StrStr
    Pop $1
    ${If} $1 == ""
      WriteRegExpandStr HKCU "Environment" "Path" "$INSTDIR\resources;$0"
      SendMessage ${HWND_BROADCAST} 0x001A 0 "STR:Environment" /TIMEOUT=5000
      ReadRegStr $0 HKCU "Environment" "Path"
    ${EndIf}

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

  ; Clean up legacy ~/.local/bin files if left by older dropper versions
  IfFileExists "$PROFILE\.local\bin\jeikcode.exe" 0 +2
    Delete "$PROFILE\.local\bin\jeikcode.exe"
  IfFileExists "$PROFILE\.local\bin\jeikcode.bak.exe" 0 +2
    Delete "$PROFILE\.local\bin\jeikcode.bak.exe"
  IfFileExists "$PROFILE\.local\bin\atomcode.exe" 0 +2
    Delete "$PROFILE\.local\bin\atomcode.exe"
  IfFileExists "$PROFILE\.local\bin\atomcode.bak.exe" 0 +2
    Delete "$PROFILE\.local\bin\atomcode.bak.exe"
  RMDir "$PROFILE\.local\bin"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Terminate any running instances before uninstalling
  nsExec::Exec 'taskkill /F /IM "jeikcode-desktop.exe" /T'
  nsExec::Exec 'taskkill /F /IM "jeikcode.exe" /T'
  Sleep 600
!macroend

!macro NSIS_HOOK_UNINSTALL
  ; Clean up desktop shortcut
  Delete "$DESKTOP\${PRODUCTNAME}.lnk"
  ; Refresh shell icon cache
  System::Call 'shell32.dll::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
