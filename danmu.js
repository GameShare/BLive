var request   = require('superagent');
var net       = require('net');   // net 模块中含有TCP套接字编程
var fs        = require('fs');
var exec      = require('child_process').exec;

var config    = require('./config.js');
var common    = require("./common.js");

var client    = new net.Socket();   // 全局 client

/**
 * 用于发送心跳包的计时器
 * 应该于 弹幕收集器 启动时打开, 于 弹幕收集器 关闭时关闭
 */
var heartTimer;

// 当前弹幕收集器的标识符, 区分不同弹幕收集器的重要标志, 在每次弹幕收集器开启时更新
var currentSymbol;

var currentRoomID;

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

// 在重启弹幕收集器时, 该变量将记录重启之前的标记, 并于 close 事件中被使用
var currentSymbol_PRE;
var danmuFileName_PRE;
var danmuAssFileName_PRE;
var danmuTempFileName_PRE;

/**
 * 为客户端添加“data”事件处理函数
 * data是服务器发回的数据
 *
 * 在此直播监听程序中, 服务器返回的数据只可能是弹幕信息
 * 因此本函数是对弹幕数据进行解析和记录
 */
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
            common.logDanmu(msgObj.info[2][1] + " 说: " + msgObj.info[1])

            // 对弹幕文件进行转义：&，<，>
            msgObj.info[1] = msgObj.info[1].replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

            var oneDanmu = '<d p="' + (msgObj.info[0][4] - xmlTime) + ',' +
                            msgObj.info[0][1] + ',' + msgObj.info[0][2] + ',' + 
                            msgObj.info[0][3] + ',' + msgObj.info[0][4] + ',' + 
                            'xxxxxxxx' + ',' + '1000000000' + '">' + msgObj.info[1] +'</d>\n';

            // 向临时文件里追加数据
            fs.appendFile(danmuTempFileName, oneDanmu, function(err){
                if(err) return common.logError(err.toString())
            });
        }
    }
});

// 为客户端添加“close”事件处理函数
client.on('close', function() {
    common.log('Connection closed ID: ' + currentSymbol_PRE);

    // 套接字关闭后, 将心跳包传输关闭
    clearInterval(heartTimer);

    // 处理临时xml文件, 使其成为标准xml文件
    fs.readFile(danmuTempFileName_PRE, 'utf8', function(err, data){

        if(err){
            common.logError('奇怪呢..这里不应该出错诶...  错误 : 打开 xml_temp 文件失败!');
            common.logError(err.toString());
            return;
        }

        var newDanmuContent = '<?xml version="1.0" encoding="UTF-8"?><i><chatserver>chat.bilibili.com</chatserver><chatid>8888888</chatid><mission>0</mission><maxlimit>8888</maxlimit><source>k-v</source>' + data + '</i>';

        // 生成标准xml文件
        fs.writeFile(danmuFileName_PRE, newDanmuContent, function(err){
            if(err) throw err;
            common.log("新弹幕文件已生成!");

            // 调用 danmaku2ass 生成标准ass文件
            var pythonCommand = `${config.pythonName} ./danmaku2ass.py -o '${danmuAssFileName_PRE}' -s ${config.s} -fn ${config.fn} -a ${config.a} -dm ${config.dm} -ds ${config.ds} '${danmuFileName_PRE}'`;
            console.log(pythonCommand)
            //python3 ./danmaku2ass.py -o ./download/20161028_214338.ass -s 1920x1080 -fn 'Noto Sans CJK SC Regular' -fs 48 -a 0.8 -dm 8 -ds 5 ./download/20161028_214338.xml

            // 执行生成 ass 文件的命令
            exec(pythonCommand, function(err ,stdout, stderr){
                if (err) {
                    return common.logError("ass文件生成 err 输出: " + err.toString());
                }

                common.log('视频ass文件成功生成!')

                if(stdout) common.log(`ass文件生成 stdout 输出: ${stdout}`)
                if(stderr) common.logError(`ass文件生成 stderr 输出: ${stderr}`)
                
            })

            // 删除临时xml文件
            fs.unlink(danmuTempFileName_PRE, function(err){
                if(err) return common.logError("临时 xml 文件删除中发生错误 : " + err.toString());

                common.log("旧弹幕文件已删除!")
            })
        })
    })
});

// 为客户端添加 "error" 事件处理函数
client.on("error", (err) => {
    common.logError("弹幕收集器发生错误 : " + err.toString());
    // restartDanmuServer(currentRoomID, currentSymbol)
})

/**
 * 开始启动弹幕服务器
 * @param  {string} RoomId            直播间的真实房间号
 * @param  {string} currentSymbolTemp 由调用方提供的本次抓取的标识符
 */
function startDanmuServer(RoomId, currentSymbolTemp){

    // 加上判断语句是可能会出现 startDanmuServer 错误(虽然在B站更新弹幕服务器后这种错误不会出现了... 不过以防万一还是加上比较好), 如果是错误重试的话就不用再更新以下的内容了
    if (currentSymbol !== currentSymbolTemp) {

        // 每次开启弹幕收集器时, 将 app.js 文件中生成的 currentSymbol 更新到当前文件
        currentSymbol     = currentSymbolTemp;

        currentRoomID     = RoomId;
        
        // 每次开启弹幕收集器时, 更新 xmlTime
        xmlTime           = Math.ceil(+new Date() / 1000);
        
        // 每次开启弹幕收集器时, 更新文件名变量
        danmuFileName     = "./download/" + currentSymbol + '.xml';
        danmuAssFileName  = "./download/" + currentSymbol + '.ass';
        danmuTempFileName = "./download/" + currentSymbol + '_temp.xml';

    }
        
    // B站 弹幕服务器最新更新: 弹幕服务器固定为 dm.live.bilibili.com, 无需再发送请求进行获取
    var danmuServer =  "dm.live.bilibili.com";
    startTCPClient(RoomId, danmuServer, currentSymbol)
}

/**
 * 开启 TCP 链接, 以从服务器接收弹幕数据
 * @param  {string} RoomId        直播间的真实房间号
 * @param  {string} danmuServer   弹幕服务器, 提供 TCP 连接
 * @param  {string} currentSymbol 当前抓取的标识符
 */
function startTCPClient(RoomId, danmuServer, currentSymbol){

    var HOST = danmuServer;
    var PORT = 788;

    // 正式开启TCP连接
    client.connect(PORT, HOST, function() {

        common.log('CONNECTED TO: ' + HOST + ':' + PORT + ' ID: ' + currentSymbol);

        // 在连接刚建立时新建弹幕临时文件, 以防止在整个阶段没有弹幕而导致文件无法生成进而引发Bug
        fs.appendFile(danmuTempFileName, '', function(err){
            if(err) return common.logError(err.toString());
        });
        
        // 每隔30秒发送一次心跳包
        // 心跳包格式固定, 不要修改
        heartTimer = setInterval(function(){
            var heart = new Buffer([0x00,0x00,0x00,0x10,0x00,0x10,0x00,0x01,0x00,0x00,0x00,0x02,0x00,0x00,0x00,0x01]);
            client.write(Buffer(heart));
            common.logSimple("已发送心跳包!")
        }, 30000)

        // 开启直播间所需要发送的数据包 其头部格式第4项是数据包的长度
        var head   = new Buffer([0x00,0x00,0x00,0x00,0x00,0x10,0x00,0x01,0x00,0x00,0x00,0x07,0x00,0x00,0x00,0x01]);
        var body   = JSON.stringify({roomid: Number(RoomId), uid: Math.ceil(100000000000000.0 + 200000000000000.0 * Math.random())})
        var buffer = Buffer(head + body);
        buffer[3]  = buffer.length;

        // 第一次发送数据包
        client.write(Buffer(buffer));
        common.log("已发送开启弹幕收集器所需要的数据包");
    });
}

/**
 * 关闭弹幕收集器
 */
function stopDanmuServer() {

    // 将重启之前的标识存入变量
    currentSymbol_PRE     = currentSymbol;
    danmuFileName_PRE     = danmuFileName;
    danmuAssFileName_PRE  = danmuAssFileName;
    danmuTempFileName_PRE = danmuTempFileName;

    client.destroy();
}

/**
 * 重启弹幕收集器
 */
function restartDanmuServer(RoomId, currentSymbolTemp) {
    stopDanmuServer();
    startDanmuServer(RoomId, currentSymbolTemp)
}

module.exports.startDanmuServer     = startDanmuServer;
module.exports.stopDanmuServer      = stopDanmuServer;
module.exports.restartDanmuServer   = restartDanmuServer;

/*
    1. 将数据以 Buffer 形式输出只需要强制转换为 Buffer 类型就好了
        Buffer(需要以 Buffer 形式输出的数据)
    
    2. 一定要记得添加 error 的错误处理, 这种错误如果没有捕获到的话是很难定位的!
 */
