var request   = require('superagent');
var net       = require('net');   // net 模块中含有TCP套接字编程
var fs        = require('fs');
var exec      = require('child_process').exec;
var config    = require('./config.js');

var client    = new net.Socket();   // 全局 client

/**
 * 用于发送心跳包的计时器
 * 应该于 弹幕收集器 启动时打开, 于 弹幕收集器 关闭时关闭
 */
var heartTimer;

// 当前弹幕收集器的标识符, 区分不同弹幕收集器的重要标志, 在每次弹幕收集器开启时更新
var currentSymbol;

// 当前弹幕收集器开始运行的时间, 以 s 计, 该变量用于控制弹幕的相对时间, 在每次弹幕收集器开启时更新
var xmlTime;

/**
 * 定义文件名, 其中 
 * danmuFileName        是 最终生成的 xml 的文件名
 * danmuAssFileName     是 最终生成的 ass 的文件名
 * danmuTempFileName    是 在收集弹幕的过程中临时xml文件的文件名
 *
 * NOTICE : 一个弹幕收集器, 只需要一个全局文件名变量 ! 当弹幕收集器重启时, 只需要改变这些变量的内容即可
 */
var danmuFileName;
var danmuAssFileName;
var danmuTempFileName;

// 为客户端添加“data”事件处理函数
// data是服务器发回的数据
client.on('data', function(data) {
    
    // 原始字符串
    var rawStr = data.toString()
    var pattern = /{"info":.*?"cmd":"(.*?)"}/g;
    
    // 通过循环将一组数据的每一条弹幕都进行输出
    while(true){

        var match = pattern.exec(rawStr)
        if(match === null) break;
        
        // match[0] 是匹配到的单个弹幕的json字符串
        var msgObj = JSON.parse(match[0]);

        // 弹幕消息
        if(msgObj.cmd === "DANMU_MSG"){
            log(msgObj.info[2][1] + " 说: " + msgObj.info[1])

            // 对弹幕文件进行转义：&，<，>
            msgObj.info[1] = msgObj.info[1].replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

            var oneDanmu = '<d p="' + (msgObj.info[0][4] - xmlTime) + ',' +
                            msgObj.info[0][1] + ',' + msgObj.info[0][2] + ',' + 
                            msgObj.info[0][3] + ',' + msgObj.info[0][4] + ',' + 
                            'xxxxxxxx' + ',' + '1000000000' + '">' + msgObj.info[1] +'</d>\n';

            // 向临时文件里追加数据
            fs.appendFile(danmuTempFileName, oneDanmu, function(err){
                if(err) return console.log(err);
            });
        }
    }
});

// 为客户端添加“close”事件处理函数
client.on('close', function() {
    log('Connection closed ID: ' + currentSymbol);

    // 套接字关闭后, 将心跳包传输关闭, 并解除所有事件
    clearInterval(heartTimer);

    // 处理临时xml文件, 使其成为标准xml文件
    fs.readFile(danmuTempFileName, 'utf8', function(err, data){

        if(err){
            log('奇怪呢..这里不应该出错诶...  错误 : 打开 xml_temp 文件失败!');
            throw err;
        }

        var newDanmuContent = '<?xml version="1.0" encoding="UTF-8"?><i><chatserver>chat.bilibili.com</chatserver><chatid>8888888</chatid><mission>0</mission><maxlimit>8888</maxlimit><source>k-v</source>' + data + '</i>';

        // 生成标准xml文件
        fs.writeFile(danmuFileName, newDanmuContent, function(err){
            if(err) throw err;
            log("新弹幕文件已生成!");

            // 调用 danmaku2ass 生成标准ass文件
            var pythonCommand = config.pythonName + " ./danmaku2ass.py -o "  + danmuAssFileName + " -s " + config.s + " -fn " + config.fn + " -fs " + config.fs + " -a " + config.a + " -dm " + config.dm + " -ds " + config.ds + " "  + danmuFileName;
            // console.log(pythonCommand)

            // 执行生成 ass 文件的命令
            exec(pythonCommand, function(err ,stdout, stderr){
                if (err) return log(err);
                log('视频ass文件正在生成!')

                if(stdout) log(`ass文件生成 stdout 输出: ${stdout}`)
                if(stderr) log(`ass文件生成 stderr 输出: ${stderr}`)
                
            })

            // 删除临时xml文件
            fs.unlink(danmuTempFileName, function(err){
                if(err) throw err;
                log("旧弹幕文件已删除!")
            })
        })
    })
});

// 为客户端添加 "error" 事件处理函数
client.once("error", (err) => {
    log("弹幕收集器发生错误 : " + err);
})

// 阶段1: 解析房间真实地址
function getTureRoomID(RoomId){
    request.get("http://live.bilibili.com/" +　RoomId)
        .timeout(3000)
        .end(function(err, res){

            if(err) {
                if(err.timeout) {getTureRoomID(RoomId);return;}
                else throw err;
            }

            // 一定几率不给回传数据
            if(!res){getTureRoomID(RoomId);return;}

            var match = res.text.match(/var ROOMID = \d*?;/)
            var TureRoomID = match[0].replace("var ROOMID = ", "").replace(";", "");
            log("成功解析房间 " + RoomId + " 的真实房间地址为 " + TureRoomID)

            var currentSymbol = createSymbol();
            startDanmuServer(TureRoomID, currentSymbol)
        })
}

// 阶段2: 解析弹幕服务器
// 该阶段也是与 app.js 连接时提供的接口
function startDanmuServer(RoomId, currentSymbolTemp){

    // 每次开启弹幕收集器时, 更新 currentSymbol
    currentSymbol = currentSymbolTemp;

    request.get("http://live.bilibili.com/api/player?id=cid:" + RoomId)
        .timeout(3000)
        .end(function(err, res){
            if(err) {
                if(err.timeout) {startDanmuServer(RoomId);return;}
                else throw err;
            }

            // var danmuServer = res.text.match(/livecmt.*?com/)[0];
            var danmuServer =  "dm.live.bilibili.com";

            log("成功解析弹幕服务器地址: " + danmuServer);
            startTCPClient(RoomId, danmuServer, currentSymbol)
        })
}

// 阶段3: 开启TCP客户端
function startTCPClient(RoomId, danmuServer, currentSymbol){

    var HOST = danmuServer;
    var PORT = 788;

    // 每次开启弹幕收集器时, 更新 xmlTime
    xmlTime   = Math.ceil(+new Date() / 1000);
    
    // 每次开启弹幕收集器时, 更新文件名变量
    danmuFileName       = currentSymbol + '.xml';
    danmuAssFileName    = currentSymbol + '.ass';
    danmuTempFileName   = currentSymbol + '_temp.xml';

    // 正式开启TCP连接
    client.connect(PORT, HOST, function() {

        log('CONNECTED TO: ' + HOST + ':' + PORT + ' ID: ' + currentSymbol);

        // 在连接刚建立时新建弹幕临时文件, 以防止在整个阶段没有弹幕而导致文件无法生成进而引发Bug
        fs.appendFile(danmuTempFileName, '', function(err){
            if(err) return console.log(err);
        });
        
        // 每隔30秒发送一次心跳包
        // 心跳包格式固定, 不要修改
        heartTimer = setInterval(function(){
            var heart = new Buffer([0x00,0x00,0x00,0x10,0x00,0x10,0x00,0x01,0x00,0x00,0x00,0x02,0x00,0x00,0x00,0x01]);
            client.write(Buffer(heart));
            log("已发送心跳包!")
        }, 30000)

        // 开启直播间所需要发送的数据包 其头部格式第4项是数据包的长度
        var head   = new Buffer([0x00,0x00,0x00,0x00,0x00,0x10,0x00,0x01,0x00,0x00,0x00,0x07,0x00,0x00,0x00,0x01]);
        var body   = JSON.stringify({roomid: Number(RoomId), uid: Math.ceil(100000000000000.0 + 200000000000000.0 * Math.random())})
        var buffer = Buffer(head + body);
        buffer[3]  = buffer.length;

        // 第一次发送数据包
        client.write(Buffer(buffer));
        log("已发送开启弹幕收集器所需要的数据包");
    });
}

/**
 * 关闭弹幕收集器
 */
function stopDanmuServer() {
    client.destroy();
}

/**
 * 重启弹幕收集器
 */
function restartDanmuServer(RoomId, currentSymbolTemp) {
    stopDanmuServer();
    startDanmuServer(RoomId, currentSymbolTemp)
}

/**
 * 获取区分不同时间的标识符
 * 当前是根据系统时间来确定, 举例为 : 20161018_182620
 */
function createSymbol() {
    return new Date(Math.floor(Date.now() / 1000) * 1000).toLocaleString().replace(/:/g, "").replace(/-/g, "").replace(/ /g, "_")
}

// 记录数据
function log(str){
    console.log(new Date().toLocaleString() + "  " + str);
}

module.exports.startDanmuServer     = startDanmuServer;
module.exports.stopDanmuServer      = stopDanmuServer;
module.exports.restartDanmuServer   = restartDanmuServer;

/*
    1. 将数据以 Buffer 形式输出只需要强制转换为 Buffer 类型就好了
        Buffer(需要以 Buffer 形式输出的数据)
    
    2. 一定要记得添加 error 的错误处理, 这种错误如果没有捕获到的话是很难定位的!
 */
