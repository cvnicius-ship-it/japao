const {spawn}=require('child_process');
for(const name of ['server.js','bot.js']){const child=spawn(process.execPath,[name],{stdio:'inherit',env:process.env});child.on('exit',code=>console.log(name,'encerrou:',code))}
