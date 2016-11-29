const cp = require("child_process");

module.exports = function(timeSecond, callback) {
    cp.execFile(`${__dirname}\\timeSet.exe`, [timeSecond.toString()], (err, stdout, stderr) => {
        if (err) return callback(new Error("在校正系统时间发生错误" + err.toString()));
        if (stderr) return callback(new Error("在校正系统时间发生错误" + stderr));

        switch (stdout) {
            case "Pemission Denied!" : return callback(new Error("在校正系统时间发生错误: 权限不够"));
            case "TimeLimit" : return callback(new Error("在校正系统时间发生错误: 时间限制"));
            case "Success" : callback(null);
        }
    })
}