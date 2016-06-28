var request   = require('superagent');
var net       = require('net');   // net 模块中含有TCP套接字编程
var fs        = require('fs');
var exec      = require('child_process').exec;
var config    = require('./config.js');

var client = new net.Socket();  // 全局 client
var heartTimer;                 // 全局计时器

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

            var currentTime = Math.floor(Date.now()/1000);
            getDanmuServer(TureRoomID, currentTime)
        })
}

// 阶段2: 解析弹幕服务器
// 该阶段也是与 app.js 连接时提供的接口
function getDanmuServer(RoomId, currentTime){
    request.get("http://live.bilibili.com/api/player?id=cid:" + RoomId)
        .timeout(3000)
        .end(function(err, res){
            if(err) {
                if(err.timeout) {getDanmuServer(RoomId);return;}
                else throw err;
            }

            var danmuServer = res.text.match(/livecmt.*?com/)[0];
            log("成功解析弹幕服务器地址: " + danmuServer);
            startTCPClient(RoomId, danmuServer, currentTime)
        })
}

// 阶段3: 开启TCP客户端
function startTCPClient(RoomId, danmuServer, startTime){

    var HOST = danmuServer;
    var PORT = 788;
    
    // 定义文件名, 其中 
    // danmuFileName        是 最终生成的 xml 的文件名
    // danmuAssFileName     是 最终生成的 ass 的文件名
    // danmuTempFileName    是 在收集弹幕的过程中临时xml文件的文件名
    var danmuFileName = new Date(startTime * 1000).toLocaleString().replace(/:/g, "").replace(/-/g, "").replace(/ /g, "_") + '.xml';
    var danmuAssFileName = new Date(startTime * 1000).toLocaleString().replace(/:/g, "").replace(/-/g, "").replace(/ /g, "_") + '.ass';
    var danmuTempFileName = new Date(startTime * 1000).toLocaleString().replace(/:/g, "").replace(/-/g, "").replace(/ /g, "_") + '_temp.xml';

    // 正式开启TCP连接
    client.connect(PORT, HOST, function() {

        log('CONNECTED TO: ' + HOST + ':' + PORT + ' ID: ' + startTime);

        // 在连接刚建立时新建弹幕临时文件, 以防止在整个阶段没有弹幕而导致文件无法生成进而引发Bug
        fs.appendFile(danmuTempFileName, '', function(err){
            if(err) return console.log(err);
        });
        
        // 每隔30秒发送一次心跳包
        // 心跳包格式固定, 不要修改
        var heartTimer = setInterval(function(){
            var heart = new Buffer([0x00,0x00,0x00,0x10,0x00,0x10,0x00,0x01,0x00,0x00,0x00,0x02,0x00,0x00,0x00,0x01]);
            client.write(Buffer(heart));
            log("已发送心跳包!")
        }, 30000)

        // 开启直播间所需要发送的数据包 其头部格式第4项是数据包的长度
        var head = new Buffer([0x00,0x00,0x00,0x00,0x00,0x10,0x00,0x01,0x00,0x00,0x00,0x07,0x00,0x00,0x00,0x01]);
        var body = JSON.stringify({roomid: Number(RoomId), uid: Math.ceil(100000000000000.0 + 200000000000000.0 * Math.random())})
        var buffer = Buffer(head + body);
        buffer[3] = buffer.length;
        console.log(Buffer(buffer));

        // 第一次发送数据包
        client.write(Buffer(buffer));
    });

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

                var oneDanmu = '<d p="' + (msgObj.info[0][4] - startTime) + ',' +
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
        console.log('Connection closed ID: ' + startTime);

        // 套接字关闭后, 将心跳包传输关闭
        clearInterval(heartTimer);

        // 处理临时xml文件, 使其成为标准xml文件
        fs.readFile(danmuTempFileName, 'utf8', function(err, data){

            if(err){
                console.log('奇怪呢..这里不应该出错诶...');
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
                exec(pythonCommand, function(error,stdout,stderr){
                    log('视频ass文件正在生成!')
                    if(stdout.length >1){
                        console.log('you offer args:',stdout);
                    } else {
                        console.log('you don\'t offer args');
                    }
                    if(error) {
                        console.info('stderr : '+stderr);
                    }
                })

                // 删除临时xml文件
                fs.unlink(danmuTempFileName, function(err){
                    if(err) throw err;
                    log("旧弹幕文件已删除!")
                })
            })
        })
    });
}

// 记录数据
function log(str){
    console.log(new Date().toLocaleString() + "  " + str);
}

module.exports.getDanmu = getDanmuServer;
module.exports.client   = client;

/*
    1. 将数据以 Buffer 形式输出只需要强制转换为 Buffer 类型就好了
        Buffer(需要以 Buffer 形式输出的数据)

 */
