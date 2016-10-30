// 相关设置
var config = {

    // 直播间的房间号
    roomId: 93889,

    // 断线之后重连的等待时间
    timeout : 3000,

    // 电脑里python的程序名称, 默认为 windows 下的 python, python版本需要大于3
    pythonName : 'python3',

    // 视频的分辨率, 默认为 1920*1080
    // 该参数理论上无论视频分辨率是什么都不用修改
    s: '1920x1080',

    // 输出的ass文件中的字体, 默认为 'Noto Sans CJK SC Regular'
    // 注意: 如果字体中间有空格 一定要用引号扩起来!!!
    fn: "'Noto Sans CJK SC Regular'",

    // 输出的ass文件中的字体大小, 默认为 48
    fs: 48,

    // 透明度, 默认为 0.8
    a: 0.8,

    // 滚动弹幕时间, 默认为 8
    dm: 8,

    // 静止弹幕时间, 默认为 5 (在直播中, 尚无顶端弹幕和底端弹幕, 所以这一条暂时没用)
    ds: 5
}

module.exports = config;


/*

Python文件的方法:

    Command line reference

    usage: danmaku2ass.py [-h] [-o OUTPUT] -s WIDTHxHEIGHT [-fn FONT] [-fs SIZE]
                          [-a ALPHA] [-dm SECONDS] [-ds SECONDS] [-p HEIGHT] [-r]
                          FILE [FILE ...]

    positional arguments:
      FILE                  Comment file to be processed

    optional arguments:
      -h, --help            show this help message and exit
      -o OUTPUT, --output OUTPUT
                            Output file
      -s WIDTHxHEIGHT, --size WIDTHxHEIGHT
                            Stage size in pixels
      -fn FONT, --font FONT
                            Specify font face [default: Helvetica]
      -fs SIZE, --fontsize SIZE
                            Default font size [default: 25]
      -a ALPHA, --alpha ALPHA
                            Text opacity
      -dm SECONDS, --duration-marquee SECONDS
                            Duration of scrolling comment display [default: 5]
      -ds SECONDS, --duration-still SECONDS
                            Duration of still comment display [default: 5]
      -p HEIGHT, --protect HEIGHT
                            Reserve blank on the bottom of the stage
      -r, --reduce          Reduce the amount of comments if stage is full

*/