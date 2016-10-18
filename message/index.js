var cp = require("child_process")

module.exports = function(title, body, callback) {

    title    = title || "Test Title";
    body     = body  || "Test Body";
    callback = callback || function(){};

    switch (process.platform) {
        case "win32" :
            var requestJson = {
                AppId : "DesktopToast.Proxy",       // 此处不可进行修改！
                ToastTitle : title,
                ToastBody  : body,
            }
            var requestStr = JSON.stringify(requestJson)
            cp.execFile(__dirname + "/windows/DesktopToast.Proxy.exe", [requestStr], (err) => {if(err) callback(err); })
            break;
        case "linux" :
            cp.exec(`notify-send "${title}" "${body}"`, (err) => {if(err) callback(err);})
            break;
        default :
            callback(new Error("找不到你所在平台的通知方法!"))
    }
}

// module.exports("Bilibili 直播监听程序", "房间号 23333 已开启!");