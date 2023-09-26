const express = require("express");
const app = express();
app.use(express.json());

const path = require("path");
const dbPath = path.join(__dirname, "twitterClone.db");

const { open } = require("sqlite");
const sqlite3 = require("sqlite3");

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

let db = null;

const initializer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server Running at http://localhost:3000/");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};
initializer();

const getFollowingPeopleId = async () => {
  const getFollowerQuery = `SELECT following_user_id 
                              FROM follower INNER JOIN user ON user.user_id = follower.follower_user_id
                              WHERE user.username = '${username}';`;
  const followingPeople = await db.all(getFollowerQuery);
  const ids = followingPeople.map((each) => {
    each.following_user_id;
  });
  return ids;
};

const authenticateToken = (request, response, next) => {
  let jwtToken;
  const autHeader = request.headers["authorization"];
  if (autHeader) {
    jwtToken = autHeader.split(" ")[1];
  }

  if (jwtToken) {
    jwt.verify(jwtToken, "SECRET_KEY", (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        request.userId = payload.userId;
        next();
      }
    });
  } else {
    response.send(401);
    response.send("Invalid JWT Token");
  }
};

const tweetAccessVerify = async (request, response, next) => {
  const { userId } = request;
  const { tweetId } = request.params;
  const getTweetQuery = `SELECT * FROM tweet INNER JOIN follower ON tweet.user_id = follower.following_user_id
                             WHERE tweet.tweet_id = '${tweetId}' AND follower_user_id = '${userId}';`;
  const tweet = await db.get(getTweetQuery);
  if (tweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const userDetails = await db.get(getUserQuery);

  if (userDetails !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const hashedPassword = await bcrypt.hash(password, 10);
      const createQuery = `INSERT INTO user (username,password,name,gender)
                                    VALUES ('${username}', '${hashedPassword}', '${name}','${gender}')`;
      await db.run(createQuery);
      response.send("User created successfully");
    }
  }
});

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const userDetails = await db.get(getUserQuery);

  if (userDetails !== undefined) {
    const passwordMatch = await bcrypt.compare(password, userDetails.password);
    if (passwordMatch) {
      const payload = { username, userId: userDetails.user_id };
      const jwtToken = jwt.sign(payload, "SECRET_KEY");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  } else {
    response.status(400);
    response.send("Invalid user");
  }
});

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { username } = request;
  const followingPeople = await getFollowingPeopleId(username);

  const getTweetsQuery = `SELECT username,tweet,date_time as dateTime
                              FROM user INNER JOIN tweet ON user.user_id = tweet.user_id
                              WHERE user.user_id IN (${followingPeople})
                              ORDER BY date_time DESC
                              LIMIT 4;`;
  const tweets = await db.all(getTweetsQuery);
  response.send(tweets);
});

app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username, userId } = request;
  const getFollowingQuery = `SELECT name FROM follower INNER JOIN user ON user.user_id = follower.following_user_id
                                 WHERE follower_user_id = '${userId}';`;
  const followingPeople = await db.all(getFollowingQuery);
  response.send(followingPeople);
});

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { username, userId } = request;
  const getFollowingQuery = `SELECT DISTINCT name FROM follower INNER JOIN user ON user.user_id = follower.follower_user_id
                                 WHERE following_user_id = '${userId}';`;
  const followingPeople = await db.all(getFollowingQuery);
  response.send(followingPeople);
});

app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  tweetAccessVerify,
  async (request, response) => {
    const { username, userId } = request;
    const { tweetId } = request.params;
    const getTweetQuery = `SELECT tweet 
    (SELECT COUNT() FROM Like WHERE tweet_id = '${tweetId}') AS likes,
    (SELECT COUNT() FROM reply WHERE tweet_id = '${tweetId}') AS replies,
    date_time AS dateTime
    FROM tweet WHERE tweet.tweet_id = '${tweetId}';`;
    const tweet = await db.get(getTweetQuery);
    response.send(tweet);
  }
);

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  tweetAccessVerify,
  async (request, response) => {
    const { tweetId } = request.params;
    const getLikesQuery = `SELECT username FROM user INNER JOIN like ON user.user_id = like.user_id
    WHERE tweet_id = '${tweetId}';`;
    const likedUsers = await db.all(getLikesQuery);
    const users = likedUsers.map((each) => {
      each.username;
    });
    response.send({ likes: users });
  }
);

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  tweetAccessVerify,
  async (request, response) => {
    const { tweetId } = request.params;
    const getRepliedQuery = `SELECT name, reply FROM user INNER JOIN reply ON user.user_id = reply.user_id
    WHERE tweet_id = '${tweetId}';`;
    const ReplyUsers = await db.all(getRepliedQuery);
    response.send({ replies: ReplyUsers });
  }
);

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { userId } = request;
  const getTweetsQuery = `SELECT tweet, COUNT(DISTINCT like_id) AS likes,
    COUNT(DISTINCT reply_id) AS replies,
    date_time AS dateTime FROM tweet LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id LEFT JOIN like ON tweet.tweet_id = like.tweet_id
    WHERE tweet.user_id = ${userId}
    GROUP BY tweet.tweet_id;`;
  const tweets = await db.all(getTweetsQuery);
  response.send(tweets);
});

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request.body;
  const userId = parseInt(request.userId);
  const dateTime = new Date().toJSON().substring(0, 19).replace("T", " ");
  const createQuery = `INSERT INTO tweet(tweet,user_id,date_time)
    VALUES ('${tweet}', '${userId}', '${dateTime}');`;

  await db.run(createQuery);
  response.send("Created a Tweet");
});

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { userId } = request;
    const getTweetQuery = `SELECT * FROM tweet WHERE user_id = '${userId}' AND tweet_id = '${tweetId}';`;
    const tweet = await db.get(getTweetQuery);
    if (tweet === undefined) {
      response.status(401);
      response.send("Tweet Required");
    } else {
      const deleteQuery = `DELETE FROM tweet WHERE tweet_id = '${tweetId}';`;
      await db.run(deleteQuery);
      response.send("Tweet Removed");
    }
  }
);
module.exports = app;
