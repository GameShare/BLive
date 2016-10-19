var colors    = require('colors'); 

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
     * 获取区分不同时间的标识符
     * 当前是根据系统时间来确定, 示例为 : 20161018_182620
     */
    createSymbol(){
        return new Date(Math.floor(Date.now() / 1000) * 1000).toLocaleString().replace(/:/g, "").replace(/-/g, "").replace(/ /g, "_")
    }
}