var MongoClient = require('mongodb').MongoClient;
var url = "mongodb://localhost:27017/";

/* Create a set of mock users for leaderboard */
var mockUsers = [];
for(var i = 1; 100000 >= i; i++){
    mockUser = {
        userId: i,
        userName: "USER" + ("000000" + i.toString()).slice(-6),
        age: 13 + Math.floor(Math.random() * 30),
        lastRank: 0,
        coin: 0
    }
    mockUsers.push(mockUser);
}

MongoClient.connect(url, function(err, db){
    if(err)
        console.log("Installation Error!");
    else{
        var dbo = db.db("leaderboard");
        dbo.createCollection("user", function(err, res){
            if(err)
                console.log("Installation Error!");
            else{
                console.log("Collection Created!");
            }
        });
        dbo.collection("user").insertMany(mockUsers, function(err, res){
            if(err)
                console.log("Data Population Error!");
            else{
                console.log(res.insertedCount + "Mock Data Populated!");
            }
            process.exit();
        });
    }
});