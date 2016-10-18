var cp = require("child_process")

var requestJson = {
    AppId : "DesktopToast.Proxy",       // 此处不可进行修改！

    ToastTitle : "这里是通知的标题",
    ToastBody  : "这里是通知的身体",
}

var requestStr = JSON.stringify(requestJson)

cp.execFile(__dirname + "/windows/DesktopToast.Proxy.exe", [requestStr], (err, stdout, stderr) => {if(err) throw err; })