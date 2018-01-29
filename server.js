/*  Including libraries
    MongoClient is offical driver of MongoDB for NodeJS.
    Express is fast and minimalist web framework for NodeJS.
    Socket.io is fast and reliable real-time engine.
*/
var MongoClient = require('mongodb').MongoClient;
var express = require('express');
var app = express();
var server = require('http').Server(app);
var io = require('socket.io')(server);

var url = "mongodb://localhost:27017/";
var db;
var dbo;

var first_hundred = []; //Array of first hundred in leaderboard.
var last_treasure = 0; //Total coin in treasure.

var main = async function(){
    await connect_database(); //Establish connection to mongodb.

    get_first_hundred(); //Update first_hundred array.
    get_treasure(); //Update last_treasure value.

    start_web_service(); //Start webservice.

    /*  Handles connections from clients.
        - req_leaderboard: Client sends username, to find individual leaderboard.
        - pass_aday: An "test" function.
        + timeout: gives a timeout for each req_leaderboard request.
    */
    io.on('connection', function (socket) {
        var timeout = 2000;
        var process_permission = true;
        socket.on('req_leaderboard', async function (data) {
            if(process_permission){
                leaderboard = await fetch_leaderboard(data.userName);
                socket.emit('leaderboard',
                {
                    leaderboard: leaderboard,
                    treasure: last_treasure
                });

                console.log("New request!");

                /* Flood protection */
                process_permission = false;
                setTimeout(function(){process_permission = true;},timeout);
            } else{
                console.log("Too many requests!");
            }
        });
        socket.on('pass_a_day', async function (data) {
            await pass_aday();
        });
        // Experimental!
        socket.on('transfer', async function (data) {
            update_coin(data.userName, data.coin);
        });
    });
};

/* Establishes mongodb connection */
var connect_database = async function(){
    db = await MongoClient.connect(url);
    dbo = db.db("leaderboard");
};

/*  Starts web service
    -socket.io's dist file will be given as /dist static path.
    -client.html will be main path.
*/
var start_web_service = function(){
    server.listen(80);
    app.use("/dist", express.static(__dirname + "/node_modules/socket.io-client/dist"));

    app.get('/', function (req, res) {
        res.sendFile(__dirname + '/client.html');
    });
};

/*  Creates leaderboard for given userName.
    - First hundred in leaderboard will always shown!
    - Given username always be shown!
    - Next two after given user always be shown!
    - Previous three before given user always be shown!
*/
var fetch_leaderboard = async function(userName){
    var output = [];

    var me = await dbo.collection("user").findOne({userName: userName});
    if(me == null)
        return first_hundred;

    var rank = await dbo.collection("user").find({$or: [{coin: {$gt: me.coin}}, {coin: {$eq: me.coin}, userName: {$lt: me.userName}} ]}).count()+1;
    me.rank = rank;

    var next = [];
    var prev = [];

    if(rank <= 98){
        output = first_hundred;
    } else if(rank <= 101){
        next = await get_next_users(me.userName, me.coin, 100-rank, rank);
        output = first_hundred.concat(next);
    } else if(rank <= 104){
        next = await get_next_users(me.userName, me.coin, 2, rank);
        prev = await get_prev_users(me.userName, me.coin, rank-101, rank);
        output = first_hundred.concat(prev).concat([me]).concat(next);
    } else{
        next = await get_next_users(me.userName, me.coin, 2, rank);
        prev = await get_prev_users(me.userName, me.coin, 3, rank);
        output = first_hundred.concat(prev).concat([me]).concat(next);
    }

    return output;
};

/*  A semi-recursive function that refreshes first hundred in each one second.
    Since first hundred always be shown, keeping it as a global value will be efficent.
*/
var get_first_hundred = function(){
    var sort = {coin: -1, userName: 1};
    dbo.collection("user").find().sort(sort).limit(100).toArray(function(err, data){
        if(err)
            console.log("Error during update!");

        for(var i = 0; data.length > i; i++){
            data[i].rank = i+1;
        }

        first_hundred = data;
        setTimeout(get_first_hundred, 1000);
    });
};

/* Finds as much as needed for previous users before given user. */
var get_prev_users = async function(userName, coin, limit, rank){
    var query = {
        $or: [
            {
                coin: {$gt: coin}
            },
            {
                coin: {$eq: coin},
                userName: {$lt: userName}
            }
        ]
    };
    var sort = {coin: 1, userName: -1};

    var prev_users = await dbo.collection("user").find(query).sort(sort).limit(limit).toArray();

    for(var i = 0; prev_users.length > i; i++){
        prev_users[i].rank = rank - i - 1;
    }

    return prev_users.reverse();
};

/* Finds as much as needed for next users after given user. */
var get_next_users = async function(userName, coin, limit, rank){
    var query = {
        $or: [
            {
                coin: {$lt: coin}
            },
            {
                coin: {$eq: coin},
                userName: {$gt: userName}
            }
        ]
    };
    var sort = {coin: -1, userName: 1};

    var next_users = await dbo.collection("user").find(query).sort(sort).limit(-1*limit).toArray();

    for(var i = 0; next_users.length > i; i++){
        next_users[i].rank = rank + i + 1;
    }

    return next_users;
};

/* Each day's treasure data will be held in treasure as one row for one day, maximum of 7. */
var get_treasure = function(){
    dbo.collection("treasure").find().toArray(function(err, data){
        var total_treasure = 0;
        data.forEach(function(element){
            total_treasure += element.coin;
        });

        last_treasure = total_treasure;
    });
};

/*  An experimental pass day function. In real case, random development should be excluded.
    Simply calculates last ranks for the day, and for distribute treasures in 7 days.
*/
var pass_aday = async function(){
    var treasure_stash = await dbo.collection("treasure").find().toArray();
    var sort = {coin: -1, userName: 1};

    if(treasure_stash.length < 7){
        dbo.collection("user").find().sort(sort).toArray(function(err, data){
            var treasure = 0;

            for(var i = 0; data.length > i; i++){
                var inc = Math.floor(Math.random()*1000);
                treasure += Math.floor(inc/50);
                data[i].coin += inc; // Creates mock increment. Will be excluded.
                data[i].lastRank = i;
            }

            update_database(data, treasure);
        });
    } else{ //In each 7 day.
        var total_treasure = 0;

        treasure_stash.forEach(function(element){
            total_treasure += element.coin;
        });

        dbo.collection("user").find().sort(sort).toArray(function(err, data){
            var inc;

            for(var i = 0; data.length > i; i++){
                /* Distribute coins to winners! */
                if(i == 0){
                    inc = Math.floor(total_treasure/5);
                } else if(i == 1){
                    inc = Math.floor(total_treasure/100)*15;
                } else if(i == 2){
                    inc = Math.floor(total_treasure/10);
                } else if(i < 100){
                    left_treasure = total_treasure - (Math.floor(total_treasure/5) + Math.floor(total_treasure/100)*15 + Math.floor(total_treasure/10));
                    inc = Math.floor(left_treasure/97);
                } else{
                    inc = 0;
                }

                data[i].coin = inc;
                data[i].lastRank = 0;
            }
            update_database(data, 0);
        });
    }

};

/* Updates whole database. Dangerous for a no-sql database, should be improved! */
var update_database = async function(data,treasure){
    if(treasure == 0)
        await dbo.collection("treasure").deleteMany({});
    else
        await dbo.collection("treasure").insertOne({coin: treasure});

    await dbo.collection("user").deleteMany();
    await dbo.collection("user").insertMany(data);

    get_treasure();
    console.log("Database updated!");
    force_refresh();
};

/* Forces each connected client to refresh! */
var force_refresh = function(){
    io.sockets.emit("force_refresh",{});
};

/* Experimental function for server. */
var update_coin = function(userName, coin){
    dbo.collection("user").updateOne({userName: userName},{$inc: {coin: coin}}, function(err, data){
        if(err){
            console.log("Error in transaction for "+userName+" amount of "+coin);
            update_coin(userName, coin);
        } else{
            update_treasure(Math.floor(coin/50));
        }
    });

};

var update_treasure = function(coin){
    dbo.collection("user").updateOne({},{$inc: {coin: coin}}, function(err, data){
        if(err){
            update_treasure(coin);
        }
    });
};

/* Experimental functions ends! */

main();