var request       = require('superagent');
var fs            = require('fs');
var process       = require('process');

var config        = require('./config.js');
var danmu         = require("./danmu.js");

/*房间ID号*/
var RoomId        = config.roomId;        // 直播间的视频ID

/*FLAGs*/
var statusFlag    = false;      // 直播间是否开启
var streamFlag    = false;      // 文件传输是否正在进行

var tempBytesRead = -1;         // 传输数据的临时值

// 对弹幕的检查:关于弹幕采用如下规则
// 首次运行时检查当前视频流是否开启, 并收集弹幕; 若视频流开启, 同时将 danmuFlag 置为1
// 定时检查时, 再次检测视频流是否开启; 
// 若视频流开启而之前视频流断开, 则重启弹幕收集器, 并将起始时间置为此次检测的时间, 同时将 danmuFlag 置为1
// 若视频流关闭而之前视频流开启, 则重启弹幕收集器, 并将起始时间置为此次检测的时间, 同时将 danmuFlag 置为0
var danmuFlag = 0;
var firstFlag = 1;

/*Global RBQ*/
var videoRBQ;

// 首先获取房间的真实ID
getTrueRoomID(RoomId)

// 阶段1: 获取真实的RoomId
function getTrueRoomID(RoomId){
    request.get("http://live.bilibili.com/" +　RoomId)
        .timeout(3000)
        .end(function(err, res){
            if(err) {
                if(err.timeout) getTrueRoomID(RoomId)
                else throw err;
            }

            // 一定几率不给回传数据
            if(!res){getTrueRoomID(RoomId);return;}

            var match = res.text.match(/var ROOMID = \d*?;/)
            var TrueRoomID = match[0].replace("var ROOMID = ", "").replace(";", "");
            log('已解析出房间真实地址, 开始进行视频解析');

            // 在获取到房间的真实信息后, 运行下一个函数以开始爬取
            main(TrueRoomID)
        })
}

// 阶段2:　主函数, 开始进行弹幕和视频的爬取
function main(RoomId){

    // 连接弹幕服务器
    var currentTime = Math.floor(Date.now()/1000);
    danmu.getDanmu(RoomId, currentTime)

    // 连接视频服务器
    checkRoomInfo(RoomId)

    // 定时检查视频连接是否还在, 如果已断开则重连
    setInterval(function(){
        checkRoomInfo(RoomId);

        // videoRBQ.req.socket.bytesRead 里面是目前该 socket 已传输的数据量
        // tempBytesRead 是上一次检查的时候已传输的数据量
        // 如果判断语句中的两者相等, 则代表在20s内没有数据获取,可以认为是连接已经断开
        // 在断开后, checkRoomInfo函数在定时检查直播状态时, 如果发现直播间还在, 则会进行连接
        // 由此, 实现了断线重连功能
        if(videoRBQ && videoRBQ.req.socket.bytesRead === tempBytesRead){
            videoRBQ.abort();
            streamFlag = false;
            log("因网络原因, 连接已断开");

            // 网络原因断开后, 弹幕收集器重启
            log("直播间已重启, 故弹幕收集器已重启!")
            danmu.client.destroy();

            var currentTime = Math.floor(Date.now()/1000);
            danmu.getDanmu(RoomId, currentTime)

            danmuFlag = 0;
            
        // 如果判断语句中的两者不相等, 则代表数据依然在传输, 则更新目前已传输数据
        } else if (streamFlag) {
            tempBytesRead = videoRBQ.req.socket.bytesRead;
        }
    }, 20000)
}



// 视频服务器的检查连接
function checkRoomInfo(RoomId, isFirst){

    request.get('http://live.bilibili.com/live/getInfo?roomid=' + RoomId)
        .timeout(5000)
        .end(function(err, res){
            log("statusFlag " + statusFlag + "  streamFlag " + streamFlag)
            if(err) {
                if(err.timeout) {checkRoomInfo(); return;}
                else return;
            }


            // log(JSON.parse(res.text).data._status)   // Debug 专用
            // console.log(new Date().toLocaleString() + res.text)

            // JSON.parse(res.text).data._status 理论上只有两个值 on 和 off
            // on 代表该直播间已开启, off 代表该直播间已关闭
            // 但需要注意的是, 直播间开启并不代表up主正在上传视频, 因为两者并不同步
            switch(JSON.parse(res.text).data._status){

                // 如果直播间开启, 而且之前直播间是关闭的, 则调用 startDownload 开始下载视频
                case "on" : 
                    if(!statusFlag || !streamFlag){
                        log('直播间开启');
                        startDownload(RoomId);
                    }
                    statusFlag = true;
                    break;

                // 如果直播间关闭, 而且之前直播间是开启的, 则断开连接
                case "off" : 
                    if(statusFlag){
                        log('直播间关闭');
                        statusFlag = false;
                        if(streamFlag){
                            videoRBQ.abort();
                            streamFlag = false;
                        }
                    }

                    // 弹幕重启下载
                    if(danmuFlag && !firstFlag){
                        log("直播间已关闭, 故弹幕收集器已重启!")
                        danmu.client.destroy();

                        var currentTime = Math.floor(Date.now()/1000);
                        danmu.getDanmu(RoomId, currentTime)

                        danmuFlag = 0;
                    }

                    firstFlag = 0;
                    break;

                // 理论上是不会走到这一块的..
                // 如果走到的话...一般是此次请求未收到数据或收到了错误的数据
                default :
                    log('直播间状态未知');
                    
            }
       })
}

// 视频服务器的检查连接 Part 2 下载视频相关
function startDownload(RoomId){

    // 要保存的视频的名称, 格式为 20160625_223516.flv
    var fileName = new Date().toLocaleString().replace(/:/g, "").replace(/-/g, "").replace(/ /g, "_") + '.flv';

    // 定义流, 用于保存视频文件
    var stream = fs.createWriteStream(fileName);

    // 发送请求, 该请求用于获取视频的下载地址
    request.get('http://live.bilibili.com/api/playurl?cid=' + RoomId + '&player=1&quality=0')
        .timeout(5000)
        .end(function(err, res){
            if(err) {
                if(err.timeout) {startDownload(); return;}
                else return;
            }

            // 一定几率会传回 {"code":-400,"msg":"room error","data":[]}
            if(res.text === '{"code":-400,"msg":"room error","data":[]}'){
                startDownload(RoomId);
                return;
            }

            // 若运行到此处, 则代表已接收到了视频地址, 接下来进行解析
            var match = res.text.match(/<url><!\[CDATA\[.*?\]\]><\/url>/)
            var url   = match[0].replace("<url><![CDATA[", "").replace("]]></url>", "");

            log('已解析出下载地址, 开始下载')

            streamFlag = true;

            // 弹幕开启下载
            // 如果不是第一次检查是否连接而且之前直播间没有开启, 则重启弹幕收集器
            if(!danmuFlag && !firstFlag){
                log("直播间已重启, 故弹幕收集器已重启!")
                danmu.client.destroy();

                var currentTime = Math.floor(Date.now()/1000);
                danmu.getDanmu(RoomId, currentTime)

                danmuFlag = 1;
            }

            firstFlag = 0;

            // 此处开始真正地下载视频, 并接到之前定义的文件上
            videoRBQ   = request.get(url);
            videoRBQ.pipe(stream)
        })
}

// 记录数据
function log(str){
    console.log(new Date().toLocaleString() + "  " + str);
}

// 使nodejs在关闭程序前先对已保存的弹幕临时文件进行处理
process.stdin.resume();
process.on('SIGINT', function() {
    log("已收到退出信号!程序将在3秒后停止运行");
    danmu.client.destroy();
    setTimeout(function(){
        process.exit();
    }, 3000)
});