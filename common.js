var colors    = require('colors'); 
var cp        = require('child_process');
var request   = require('superagent');

// 控制台颜色设置
colors.setTheme({  
    danmu: 'grey',  
    simple: 'green',  
    verbose: 'cyan',  
    prompt: 'red',  
    info: 'white',  
    data: 'blue',  
    help: 'cyan',  
    warn: 'yellow',  
    debug: 'magenta',  
    error: 'red'  
});  

module.exports = {

    // 此次监听的基本信息, 由 commonInit 进行初始化
    RoomId : undefined,
    RoomTitle : undefined,
    RoomUP : undefined,

    // 输出调试信息
    log(str){
        process.stdout.write(new Date().toLocaleString() + "  ");
        console.log(str.info);
    },

    // 输出错误信息
    logError(str){
        process.stdout.write(new Date().toLocaleString() + "  ");
        console.log(str.error);
    },

    // 输出弹幕信息
    logDanmu(str){
        process.stdout.write(new Date().toLocaleString() + "  ");
        console.log(str.danmu);
    },

    // 输出简单的调试信息
    logSimple(str){
        process.stdout.write(new Date().toLocaleString() + "  ");
        console.log(str.simple);
    },

    /**
     * 将一些可能会有用的信息存入到此模块, 以方便以后使用
     * 此方法会在首次解析房间号的时候被调用, 且整个程序过程中只会被调用一次
     * @param  {string} RoomId    直播的真实房间号
     * @param  {string} RoomTitle 直播的标题
     * @param  {string} RoomUP    直播的 UP 主
     */
    commonInit (RoomId, RoomTitle, RoomUP) {
        this.RoomId    = RoomId;
        this.RoomTitle = RoomTitle;
        this.RoomUP    = RoomUP;
    },

    /**
     * 获取区分不同时间的标识符
     * 当前是根据系统时间来确定, 示例为 : 20161018_182620
     */
    createSymbol(isNoVideo){
        var dateStr = new Date(Math.floor(Date.now() / 1000) * 1000).toLocaleString().replace(/:/g, "").replace(/-/g, "").replace(/ /g, "_")
        return this.RoomUP + " " + dateStr + (isNoVideo ? "NoVideo" : "");
    },

    /**
     * 检查当前设置的 python 的程序是否正确
     * @param  {string}   pythonCmd 当前设置的 python 指令
     * @param  {Function} callback  若有 Error, 则说明当前设置的指令并不正确
     */
    checkPython(pythonCmd, callback) {
        cp.exec(`${pythonCmd} -V`, (err, stdout, stderr) => {
            if (err || stderr) return callback(new Error("警告！未找到 python 程序"));
            if (stdout.indexOf("3.") === -1)  return callback(new Error("警告！python 的版本应该是 3"));
            callback(null);
        })
    },

    /**
     * 获取网络时间, 并进行校对
     */
    getNetTime(callback) {
        request.get('http://biaozhunshijian.51240.com/web_system/51240_com_www/system/file/biaozhunshijian/time.js/')
            .end((err, res) => {
                if (err) return callback(new Error("获取网络时间失败"));
                var match = /time\":(\d*).\d}/.exec(res.text);
                if (match === null) {return callback(new Error("获取网络时间失败"));}

                // 网络时间的毫秒数
                var newTime = Number(match[1]);

                // 略
            })
    }


}


module.exports.getNetTime()