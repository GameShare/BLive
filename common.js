const colors    = require('colors');
const cp        = require('child_process');
const request   = require('superagent');

const timeSet   = require('./timeSet/timeSet.js');

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
        cp.exec(`${pythonCmd} -V`, (err, stderr, stdout) => {
            if (err) return callback(new Error("警告！未找到 python 程序"));
            if (stderr.indexOf("3.") === -1 || stdout.indexOf("3.") === -1)  return callback(new Error("警告！python 的版本应该是 3, 而你的电脑里装的是 2"));
            callback(null);
        })
    },

    /**
     * 获取网络时间, 并进行校对
     */
    setNetTime(callback) {
        request.get('http://biaozhunshijian.51240.com/web_system/51240_com_www/system/file/biaozhunshijian/time.js/')
            .end((err, res) => {
                if (err) return callback(new Error("获取网络时间失败"));
                var match = /time\":(\d*).\d}/.exec(res.text);
                if (match === null) {return callback(new Error("获取网络时间失败"));}

                // 网络时间的秒数
                var newTime = Math.round(Number(match[1]) / 1000);

                // 若有三秒以内的误差, 则无需校正
                if (Math.abs(Date.now() / 1000 - newTime) < 3) return module.exports.logSimple("时间准确, 无需校正!");

                timeSet(newTime, (err) => {
                    if(err) return module.exports.logError(err.toString());

                    // 如果两者的时间相差超过 2 秒, 则认为校对时间失败
                    if (Math.abs(Date.now() / 1000 - newTime) > 2) {
                        module.exports.logError("校对时间失败, 可能是权限不够");
                        module.exports.logError("相差:" + Math.abs(Date.now() / 1000 - newTime) + "秒");
                        return;
                    }

                    module.exports.log("校对时间成功!")
                })
            })
    },

    /**
     * 开始定时校对, 间隔以秒为单位
     */

    setNetTimeInterval(timeout) {
        setInterval(this.setNetTime, timeout * 1000)
    }
}
