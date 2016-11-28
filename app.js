var request       = require('superagent');
var fs            = require('fs');
var colors        = require('colors'); 
var util          = require('util');

var config        = require('./config.js');
var danmu         = require("./danmu.js");
var common        = require("./common.js")

/*消息通知插件*/
var showMsg       = require("./message/index.js")

/*房间ID号*/
var RoomId        = process.argv[2] || config.roomId;        // 直播间的视频ID

/*FLAGs*/
var statusFlag    = false;      // 直播间是否开启
var streamFlag    = false;      // 文件传输是否正在进行

var tempBytesRead = -1;         // 传输数据的临时值

/**
 * 对弹幕的检查:关于弹幕采用如下规则
 * 首次运行时检查当前视频流是否开启, 并收集弹幕; 若视频流开启, 同时将 danmuFlag 置为1
 * 定时检查时, 再次检测视频流是否开启; 
 * 若视频流开启而之前视频流断开, 则重启弹幕收集器, 并将起始时间置为此次检测的时间, 同时将 danmuFlag 置为1
 * 若视频流关闭而之前视频流开启, 则重启弹幕收集器, 并将起始时间置为此次检测的时间, 同时将 danmuFlag 置为0
 *
 * 即, 弹幕服务器在整个程序的运行过程中只会不断地被重启, 而不会关闭一段时间
 *     如果 弹幕服务器 是在没有视频流的情况下运行, 则 danmuFlag 为 0
 *     如果 弹幕服务器 是在有视频流的情况下运行, 则 danmuFlag 为 1
 */
var danmuFlag = 0;
var firstFlag = 1;

/*Global RBQ*/
var videoRBQ;

/*Global Symbol*/
var currentSymbol;

// 检查 python 指令
common.checkPython(config.pythonName, (err) => {
    if (err) return common.logError(err.toString());
})

// 首先获取房间的真实ID
getTrueRoomID(RoomId)

// 阶段1: 获取真实的RoomId
function getTrueRoomID(RoomId){
    request.get("http://live.bilibili.com/" +　RoomId)
        .timeout(3000)
        .end(function(err, res){
            if(err) {
                return setTimeout(() => {
                    common.logError("getTrueRoomID 错误, 将在一定时间后重试")
                    common.logError(err.toString())
                    getTrueRoomID(RoomId)
                }, config.timeout)
            }

            // 一定几率不给回传数据
            if(!res){getTrueRoomID(RoomId);return;}

            var TrueRoomID = res.text.match(/var ROOMID = (\d*?);/)[1];
            var RoomTitle  = res.text.match(/itemprop="name" content="(.*?) - (.*?) - /)[1];
            var RoomUP     = res.text.match(/itemprop="name" content="(.*?) - (.*?) - /)[2];

            common.log(`房间信息 : 输入的房间地址为 ${RoomId}, 已解析出房间真实地址为 ${TrueRoomID}`);
            common.log(`房间信息 : 房间标题为 ${RoomTitle}, UP主为 ${RoomUP}`)

            // 对公共模块的一些基本信息进行初始化
            common.commonInit(TrueRoomID, RoomTitle, RoomUP)

            // 在获取到房间的真实信息后, 运行下一个函数以开始爬取
            main(TrueRoomID)
        })
}

// 阶段2:　主函数, 开始进行弹幕和视频的爬取
function main(RoomId){

    // 新建一个文件夹 download
    makeNewDirection();

    // 连接视频服务器
    checkRoomInfo(RoomId)

    // 定时检查视频连接是否还在, 如果已断开则重连
    setInterval(function(){
        checkRoomInfo(RoomId);
        checkStreamBytes();
    }, 20000)
}



// 视频服务器的检查连接
function checkRoomInfo(RoomId){

    request.get('http://live.bilibili.com/live/getInfo?roomid=' + RoomId)
        .timeout(5000)
        .end(function(err, res){
            common.logSimple("当前状态 : statusFlag " + statusFlag + "  streamFlag " + streamFlag)
            if(err) {
                return setTimeout(() => {
                    common.logError("checkRoomInfo 错误, 将在一定时间后重试")
                    common.logError(err.toString())
                    checkRoomInfo(RoomId)
                }, config.timeout)
            }

            // JSON.parse(res.text).data._status 理论上只有两个值 on 和 off
            // on 代表该直播间已开启, off 代表该直播间已关闭
            // 但需要注意的是, 直播间开启并不代表up主正在上传视频, 因为两者并不同步
            switch(JSON.parse(res.text).data._status){

                // 如果直播间开启, 而且之前直播间是关闭的, 则调用 startDownload 开始下载视频
                case "on" : 
                    if(!statusFlag || !streamFlag){
                        common.log(`直播间 ${RoomId} 已经开启`);
                        showMsg("BLive 直播监听程序", `直播间 ${RoomId} 已经开启`, (err) => {});

                        // 每次直播打开时, 都应该重置标识符, 同时重启弹幕收集器
                        currentSymbol = common.createSymbol();
                        danmu.restartDanmuServer(RoomId, currentSymbol)
                        danmuFlag = 0;

                        startDownload(RoomId);
                    }
                    statusFlag = true;
                    danmuFlag  = 1;
                    break;

                // 如果直播间关闭, 而且之前直播间是开启的, 则断开连接
                case "off" : 
                    if(statusFlag){
                        common.log(`直播间 ${RoomId} 已经关闭`);
                        showMsg("BLive 直播监听程序", `直播间 ${RoomId} 已经关闭`, (err) => {});
                        statusFlag = false;
                        if(streamFlag){
                            videoRBQ.abort();
                            check0ByteVideo(currentSymbol);
                            streamFlag = false;
                        }
                    }

                    // 弹幕重启下载
                    if(danmuFlag && !firstFlag){
                        common.log("直播间已关闭, 故弹幕收集器已重启!")

                        currentSymbol = common.createSymbol(true);
                        danmu.restartDanmuServer(RoomId, currentSymbol)
                        danmuFlag = 0;
                    }

                    firstFlag = 0;
                    break;

                // 理论上是不会走到这一块的..
                // 如果走到的话...一般是此次请求未收到数据或收到了错误的数据
                default :
                    common.logError('直播间状态未知');
                    common.logError(`收到的状态码为 : ${JSON.parse(res.text).data._status}`);
                    
            }
       })
}

/**
 * videoRBQ.req.socket.bytesRead 里面是目前该 socket 已传输的数据量
 * tempBytesRead 是上一次检查的时候已传输的数据量
 * 如果判断语句中的两者相等, 则代表在一定时间内没有数据获取,可以认为是连接已经断开
 * 在断开后, checkRoomInfo函数在定时检查直播状态时, 如果发现直播间还处于开启状态, 则会进行连接
 * 由此, 实现了断线重连功能
 */
function checkStreamBytes() {

    // 如果视频流没有传输数据, 就不检查
    if (streamFlag === false) return;

    if (videoRBQ && videoRBQ.req.socket.bytesRead === tempBytesRead) {

        videoRBQ.abort();
        check0ByteVideo(currentSymbol);
        streamFlag = false;
        tempBytesRead = -1;

        common.log("因长时间未接收到数据, 连接已主动断开");
        showMsg("BLive 直播监听程序", `因长时间未接收到数据, 直播间 ${RoomId} 的连接已断开`, (err) => {});

        // 网络原因断开后, 弹幕收集器重启
        common.log("连接长时间未接收到数据, 故弹幕收集器已重启!")

        currentSymbol = common.createSymbol(true);
        danmu.restartDanmuServer(RoomId, currentSymbol)

        danmuFlag = 0;
        
    // 如果判断语句中的两者不相等, 则代表数据依然在传输, 则更新目前已传输数据
    } else if (streamFlag) {
        common.logSimple("当前阶段传输数据量 : " + (videoRBQ.req.socket.bytesRead - tempBytesRead) / 1000 + "KB/20s")
        tempBytesRead = videoRBQ.req.socket.bytesRead;
    }

}

/**
 * 开始对指定房间里的直播视频流进行下载
 * @param  {string} RoomId 直播间的真实房间号
 */
function startDownload(RoomId){

    // 要保存的视频的名称, 格式为 20160625_223516.flv
    var fileName = currentSymbol + '.flv';

    // 定义流, 用于保存视频文件
    var stream = fs.createWriteStream("./download/" + fileName);

    // 发送请求, 该请求用于获取视频的下载地址
    request.get('http://live.bilibili.com/api/playurl?cid=' + RoomId + '&player=1&quality=0')
        .timeout(5000)
        .end(function(err, res){
            if(err) {
                return setTimeout(() => {
                    common.logError("startDownload 错误, 将在一定时间后重试")
                    common.logError(err.toString())
                    startDownload(RoomId)
                }, config.timeout)
            }

            // 一定几率会传回 {"code":-400,"msg":"room error","data":[]}
            if(res.text === '{"code":-400,"msg":"room error","data":[]}'){
                startDownload(RoomId);
                return;
            }

            // 若运行到此处, 则代表已接收到了视频地址, 接下来进行解析
            var match = res.text.match(/<url><!\[CDATA\[.*?\]\]><\/url>/)
            var url   = match[0].replace("<url><![CDATA[", "").replace("]]></url>", "");

            common.log('已解析出下载地址, 开始下载, 保存的视频的文件名为 : ' + fileName)

            streamFlag = true;

            // 弹幕开启下载
            // 如果不是第一次检查是否连接而且之前直播间没有开启, 则重启弹幕收集器
            if(!danmuFlag && !firstFlag){
                common.log("直播间已重启, 故弹幕收集器已重启!")

                currentSymbol = common.createSymbol();
                danmu.restartDanmuServer(RoomId, currentSymbol)
                danmuFlag = 1;
            }

            firstFlag = 0;

            // 此处开始真正地下载视频, 并接到之前定义的文件上
            videoRBQ   = request.get(url);
            videoRBQ.pipe(stream)

            videoRBQ.on("error", (err) => {
                common.log("videoRBQ 发生错误 : " + err);
            })
        })
}

/**
 * 在当前目录下新建一个名为 download 的文件夹
 */
function makeNewDirection () {
    fs.mkdir("./download/", (err) => {});
}

/**
 * 检查刚产生的视频文件是否为0KB, 如果是, 则等待字幕生成成功后删去视频文件和字幕文件
 * 因为是检查视频文件, 所以对于非视频时间的弹幕是不做处理的
 * 进行延时检查的原因是需要等待字幕文件生成!
 */
function check0ByteVideo (checkSymbol) {
    setTimeout(() => {
        fs.stat("./download/" + checkSymbol + ".flv", (err, stats) => {
            if(err) return common.logError("检查0字节文件发送错误 : " + err.toString());

            if (stats.size < 1000) {
                common.log(`发现 0 字节视频, 标识符为 ${checkSymbol}, 即将进行删除工作!`)

                fs.unlink("./download/" + checkSymbol + ".flv", (err) => {if(err) return common.logError("删除0字节文件发送错误 : " + err.toString()); });
                fs.unlink("./download/" + checkSymbol + ".ass", (err) => {if(err) return common.logError("删除0字节文件发送错误 : " + err.toString()); });
                fs.unlink("./download/" + checkSymbol + ".xml", (err) => {if(err) return common.logError("删除0字节文件发送错误 : " + err.toString()); });
            }
        })
    }, 3000)
}


// 使nodejs在关闭程序前先对已保存的弹幕临时文件进行处理
process.stdin.resume();
process.on('SIGINT', function() {
    common.log("已收到退出信号!程序将在3秒后停止运行");
    danmu.stopDanmuServer();
    setTimeout(function(){
        process.exit(0);
    }, 3000)
});