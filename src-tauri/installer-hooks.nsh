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
!macroend
