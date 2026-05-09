import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import ytSearch from 'yt-search';

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3001;
const rooms = {};

const initRoom = (roomId) => {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      users: new Set(),
      mode: null,
      musicState: {
        queue: [],
        currentSong: null,
        isPlaying: false,
        currentTime: 0,
        lastUpdateTime: Date.now()
      },
      movieState: {
        isPlaying: false,
        currentTime: 0,
        lastUpdateTime: Date.now()
      }
    };
  }
};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join_room', ({ roomId, username }) => {
    socket.join(roomId);
    socket.username = username;
    console.log(`User ${username} (${socket.id}) joined room ${roomId}`);
    
    initRoom(roomId);
    rooms[roomId].users.add({ id: socket.id, username });
    
    const roomState = { ...rooms[roomId] };
    roomState.users = Array.from(rooms[roomId].users);
    socket.emit('room_state', roomState);
    
    socket.to(roomId).emit('user_joined', { id: socket.id, username });
  });

  socket.on('set_mode', ({ roomId, mode }) => {
    if (rooms[roomId]) {
      rooms[roomId].mode = mode;
      io.to(roomId).emit('mode_changed', mode);
    }
  });

  socket.on('music_add_queue', ({ roomId, item }) => {
    if (rooms[roomId]) {
      rooms[roomId].musicState.queue.push(item);
      if (!rooms[roomId].musicState.currentSong) {
        rooms[roomId].musicState.currentSong = rooms[roomId].musicState.queue.shift();
      }
      io.to(roomId).emit('music_queue_updated', rooms[roomId].musicState);
    }
  });

  socket.on('music_play_now', ({ roomId, item }) => {
    if (rooms[roomId]) {
      rooms[roomId].musicState.currentSong = item;
      rooms[roomId].musicState.currentTime = 0;
      rooms[roomId].musicState.isPlaying = true;
      io.to(roomId).emit('music_queue_updated', rooms[roomId].musicState);
      io.to(roomId).emit('music_play', { time: 0 });
    }
  });

  socket.on('music_remove_queue', ({ roomId, index }) => {
    if (rooms[roomId]) {
      rooms[roomId].musicState.queue.splice(index, 1);
      io.to(roomId).emit('music_queue_updated', rooms[roomId].musicState);
    }
  });

  socket.on('music_move_queue', ({ roomId, fromIndex, toIndex }) => {
    if (rooms[roomId]) {
      const queue = rooms[roomId].musicState.queue;
      if (toIndex >= 0 && toIndex < queue.length && fromIndex >= 0 && fromIndex < queue.length) {
        const [item] = queue.splice(fromIndex, 1);
        queue.splice(toIndex, 0, item);
        io.to(roomId).emit('music_queue_updated', rooms[roomId].musicState);
      }
    }
  });

  // CHANGED to io.to().emit() so the sender ALSO receives the state change
  socket.on('music_play', ({ roomId, time }) => {
    if (rooms[roomId]) {
      rooms[roomId].musicState.isPlaying = true;
      rooms[roomId].musicState.currentTime = time;
      io.to(roomId).emit('music_play', { time });
    }
  });

  socket.on('music_pause', ({ roomId, time }) => {
    if (rooms[roomId]) {
      rooms[roomId].musicState.isPlaying = false;
      rooms[roomId].musicState.currentTime = time;
      io.to(roomId).emit('music_pause', { time });
    }
  });

  socket.on('music_seek', ({ roomId, time }) => {
    if (rooms[roomId]) {
      rooms[roomId].musicState.currentTime = time;
      io.to(roomId).emit('music_seek', { time });
    }
  });

  socket.on('music_next', ({ roomId }) => {
    if (rooms[roomId]) {
      rooms[roomId].musicState.currentSong = rooms[roomId].musicState.queue.shift() || null;
      rooms[roomId].musicState.currentTime = 0;
      rooms[roomId].musicState.isPlaying = true;
      io.to(roomId).emit('music_queue_updated', rooms[roomId].musicState);
      io.to(roomId).emit('music_play', { time: 0 });
    }
  });

  socket.on('movie_play', ({ roomId, time }) => {
    if (rooms[roomId]) {
      rooms[roomId].movieState.isPlaying = true;
      rooms[roomId].movieState.currentTime = time;
      io.to(roomId).emit('movie_play', { time });
    }
  });

  socket.on('movie_pause', ({ roomId, time }) => {
    if (rooms[roomId]) {
      rooms[roomId].movieState.isPlaying = false;
      rooms[roomId].movieState.currentTime = time;
      io.to(roomId).emit('movie_pause', { time });
    }
  });

  socket.on('movie_seek', ({ roomId, time }) => {
    if (rooms[roomId]) {
      rooms[roomId].movieState.currentTime = time;
      io.to(roomId).emit('movie_seek', { time });
    }
  });

  socket.on('disconnecting', () => {
    for (const roomId of socket.rooms) {
      if (rooms[roomId]) {
        const userArr = Array.from(rooms[roomId].users);
        const updatedUsers = new Set(userArr.filter(u => u.id !== socket.id));
        rooms[roomId].users = updatedUsers;
        
        socket.to(roomId).emit('user_left', { id: socket.id });
        
        if (rooms[roomId].users.size === 0) {
           delete rooms[roomId];
        }
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

app.get('/api/search', async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: 'No query provided' });
    
    const r = await ytSearch(query);
    const videos = r.videos.slice(0, 15).map(v => ({
      id: v.videoId,
      title: v.title,
      thumbnail: v.thumbnail,
      duration: v.timestamp,
      author: v.author.name
    }));
    
    res.json(videos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Search failed' });
  }
});

httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
