; ============================================================================
; 弦予音乐 NSIS 安装自定义钩子
;
; 背景：Tauri 的 NSIS 模板已通过 MUI_LANGDLL_REGISTRY 把安装器语言写入
;   HKCU\Software\xymusic\弦予音乐 的 "Installer Language" 值（LCID 数字），
;   卸载器 un.onInit 里的 MUI_UNGETLANGUAGE 会自动读取该值继承语言，
;   因此“卸载器继承语言”无需额外处理。
;
; 本钩子仅负责：安装完成后把安装时选择的语言（$LANGUAGE，LCID）额外写入一个
;   便于主程序读取的字符串值 "AppLanguage"（应用语言码），供主程序首次启动时
;   将默认界面语言与安装语言对齐。
;
; 语言映射（NSIS $LANGUAGE 为 LCID）：
;   2052 简体中文 (SimpChinese) -> zh-CN
;   1028 繁体中文 (TradChinese) -> zh-TW
;   1033 English  (English)     -> en-US
; ============================================================================

!define XY_LANG_REGKEY "Software\xymusic\${PRODUCTNAME}"
!define XY_LANG_REGVALUE "AppLanguage"

!macro NSIS_HOOK_POSTINSTALL
  ${If} $LANGUAGE == 1028
    WriteRegStr HKCU "${XY_LANG_REGKEY}" "${XY_LANG_REGVALUE}" "zh-TW"
  ${ElseIf} $LANGUAGE == 1033
    WriteRegStr HKCU "${XY_LANG_REGKEY}" "${XY_LANG_REGVALUE}" "en-US"
  ${Else}
    WriteRegStr HKCU "${XY_LANG_REGKEY}" "${XY_LANG_REGVALUE}" "zh-CN"
  ${EndIf}
  ; 「打开方式」列表的应用名跟随安装语言：中文系统显示「弦予音乐」，其它显示 "XianYuMusic"。
  ; 背景：Tauri 模板把文件关联 ProgId（XY-Music Audio / XY-Music Plugin Script）的默认值
  ;   写成 description（如 "XY-Music Audio File"），右键「打开方式」显示的就是它。
  ;   这里覆盖默认值并补 FriendlyTypeName（shell 显示名优先级最高）。升级重装时 Tauri
  ;   会重写默认值，本钩子在其后重跑，覆盖始终生效。ProgId 键名保持不动（shell\open\command
  ;   与 .ext 默认值都挂在它下面）。
  ${If} $LANGUAGE == 2052
  ${OrIf} $LANGUAGE == 1028
    WriteRegStr HKCU "Software\Classes\XY-Music Audio" "FriendlyTypeName" "弦予音乐"
    WriteRegStr HKCU "Software\Classes\XY-Music Audio" "" "弦予音乐"
    WriteRegStr HKCU "Software\Classes\XY-Music Plugin Script" "FriendlyTypeName" "弦予音乐"
    WriteRegStr HKCU "Software\Classes\XY-Music Plugin Script" "" "弦予音乐"
  ${Else}
    WriteRegStr HKCU "Software\Classes\XY-Music Audio" "FriendlyTypeName" "XianYuMusic"
    WriteRegStr HKCU "Software\Classes\XY-Music Audio" "" "XianYuMusic"
    WriteRegStr HKCU "Software\Classes\XY-Music Plugin Script" "FriendlyTypeName" "XianYuMusic"
    WriteRegStr HKCU "Software\Classes\XY-Music Plugin Script" "" "XianYuMusic"
  ${EndIf}
  ; 注册 xianyu:// URL 协议：分享落地页点「在弦予音乐中打开」时由系统
  ; 用 `"$INSTDIR\弦予音乐.exe" "%1"` 拉起本程序并带入深链参数。
  WriteRegStr HKCR "xianyu" "" "URL:弦予音乐 Protocol"
  WriteRegStr HKCR "xianyu" "URL Protocol" ""
  WriteRegStr HKCR "xianyu\DefaultIcon" "" "$\"$INSTDIR\弦予音乐.exe$\",0"
  WriteRegStr HKCR "xianyu\shell\open\command" "" "$\"$INSTDIR\弦予音乐.exe$\" $\"%1$\""
  ; 开始菜单/桌面快捷方式与「应用和功能」列表名跟随安装语言。
  ; 背景：Tauri 模板固定用 productName（简中「弦予音乐」）创建快捷方式与卸载项
  ;   DisplayName，英文系统上会显示简中。这里在安装完成后按语言重命名/覆盖：
  ;   简中保持默认；繁体改「弦予音樂」；其它改 "XianYuMusic"。
  ; Rename 源不存在时只置 error flag 静默跳过，无需存在性检查；升级重装时
  ;   Tauri 会重建简中名快捷方式，本钩子再次重跑改名。
  ; 改名后的卸载残留由 NSIS_HOOK_POSTUNINSTALL 补删。
  SetShellVarContext current
  ${If} $LANGUAGE == 1028
    Rename "$SMPROGRAMS\弦予音乐.lnk" "$SMPROGRAMS\弦予音樂.lnk"
    Rename "$SMPROGRAMS\Uninstall 弦予音乐.lnk" "$SMPROGRAMS\Uninstall 弦予音樂.lnk"
    Rename "$DESKTOP\弦予音乐.lnk" "$DESKTOP\弦予音樂.lnk"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}" "DisplayName" "弦予音樂"
  ${ElseIf} $LANGUAGE == 2052
    ; 简中：Tauri 默认名即为「弦予音乐」，无需处理
  ${Else}
    Rename "$SMPROGRAMS\弦予音乐.lnk" "$SMPROGRAMS\XianYuMusic.lnk"
    Rename "$SMPROGRAMS\Uninstall 弦予音乐.lnk" "$SMPROGRAMS\Uninstall XianYuMusic.lnk"
    Rename "$DESKTOP\弦予音乐.lnk" "$DESKTOP\XianYuMusic.lnk"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}" "DisplayName" "XianYuMusic"
  ${EndIf}
!macroend

; ============================================================================
; 卸载收尾：清理安装钩子改过名的快捷方式残留。
;
; 背景：Tauri 卸载器只按 productName 静态名（弦予音乐）删快捷方式；若安装时
;   按语言改成了「弦予音樂」/ "XianYuMusic"，卸载后会残留。这里补删改名后的
;   候选名（Delete 目标不存在时静默跳过）。简中名由 Tauri 卸载器自己删。
; ============================================================================
!macro NSIS_HOOK_POSTUNINSTALL
  SetShellVarContext current
  Delete "$SMPROGRAMS\XianYuMusic.lnk"
  Delete "$SMPROGRAMS\弦予音樂.lnk"
  Delete "$SMPROGRAMS\Uninstall XianYuMusic.lnk"
  Delete "$SMPROGRAMS\Uninstall 弦予音樂.lnk"
  Delete "$DESKTOP\XianYuMusic.lnk"
  Delete "$DESKTOP\弦予音樂.lnk"
!macroend

; ============================================================================
; 卸载前清理应用数据中的大目录，加快"删除应用数据"卸载。
;
; 背景：Tauri 卸载器在用户勾选"删除应用数据"时，会用
;   RmDir /r "$APPDATA\${BUNDLEID}" 和 RmDir /r "$LOCALAPPDATA\${BUNDLEID}"
;   递归删除整个数据目录。其中 WebView2 缓存（EBWebView）有数百个小文件、
;   封面缓存（covers）有上百个图片文件，Windows 逐个删除小文件很慢，
;   导致卸载卡顿。
;
; 方案：本钩子在卸载段开头（此时 $DeleteAppDataCheckboxState 已由确认页写入）
;   提前删掉这两个大目录，让后续 RmDir /r 只剩少量文件，显著加快卸载。
;   仅在用户勾选删除时才清理，未勾选时保留全部数据。
; ============================================================================
!macro NSIS_HOOK_PREUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
    SetShellVarContext current
    RmDir /r "$LOCALAPPDATA\${BUNDLEID}\EBWebView"
    RmDir /r "$APPDATA\${BUNDLEID}\covers"
  ${EndIf}
!macroend
