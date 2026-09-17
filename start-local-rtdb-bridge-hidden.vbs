Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

projectDir = fso.GetParentFolderName(WScript.ScriptFullName)

shell.Run "cmd /c cd /d """ & projectDir & """ && npm run api", 0, False
shell.Run "cmd /c cd /d """ & projectDir & """ && npm run dev -- --host 127.0.0.1", 0, False

WScript.Sleep 3000
shell.Run "http://127.0.0.1:5173", 1, False
