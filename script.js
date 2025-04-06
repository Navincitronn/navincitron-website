document.addEventListener('DOMContentLoaded', () => {
    const searchBar = document.getElementById('search-bar');
    const dropdownLinks = document.querySelectorAll('.dropdown-content a');
    const albums = Array.from(document.getElementsByClassName('album'));
    let sortBy = 'index';
    let order = -1; 

    searchBar.addEventListener('input', () => {
        const query = searchBar.value.toLowerCase();
        let visibleAlbums = 0;
        albums.forEach(album => {
            const metadata = album.innerText.toLowerCase();
            if (metadata.includes(query)) {
                album.style.display = '';
                visibleAlbums++;
            } else {
                album.style.display = 'none';
            }
        });
    
        const gridColumns = Math.min(visibleAlbums, 5);
        document.querySelector('.album-grid').style.gridTemplateColumns = `repeat(${gridColumns}, 1fr)`;
    });

    dropdownLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            if (link.classList.contains('order')) {
                document.querySelectorAll('.order').forEach(orderLink => orderLink.classList.remove('selected'));
                order = link.getAttribute('data-order') === 'asc' ? 1 : -1;
            } else {
                // Remove 'selected' class from other sort links
                document.querySelectorAll('[data-sort]').forEach(sortLink => sortLink.classList.remove('selected'));
                sortBy = link.getAttribute('data-sort');
            }
            link.classList.add('selected');
            sortAlbums();
        });
    });
    
    document.querySelector('[data-sort="index"]').classList.add('selected');
    document.querySelector('[data-order="desc"]').classList.add('selected');
    sortAlbums();

    function sortAlbums() {
        albums.sort((a, b) => {
            let valA = a.dataset[sortBy];
            let valB = b.dataset[sortBy];
    
            if (sortBy === 'index') {
                valA = parseInt(valA, 10);
                valB = parseInt(valB, 10);
            } else if (sortBy === 'date') {
                valA = new Date(valA);
                valB = new Date(valB);
            } else if (sortBy === 'duration') {
                const durationA = valA.split(':').reduce((acc, time) => (60 * acc) + +time);
                const durationB = valB.split(':').reduce((acc, time) => (60 * acc) + +time);
    
                if (durationA !== durationB) {
                    return durationA > durationB ? order : -order;
                }
    
                const dateA = new Date(a.dataset.date);
                const dateB = new Date(b.dataset.date);
                return dateA - dateB;
            } else if (sortBy === 'artist') {
                const artistA = valA.toLowerCase();
                const artistB = valB.toLowerCase();
    
                if (artistA !== artistB) {
                    return artistA > artistB ? order : -order;
                }

                const dateA = new Date(a.dataset.date);
                const dateB = new Date(b.dataset.date);
                return dateA - dateB;
            } else {
                valA = valA.toLowerCase();
                valB = valB.toLowerCase();
            }
    
            return valA > valB ? order : -order;
        });
        const parent = albums[0].parentNode;
        albums.forEach(album => parent.appendChild(album));
    }
       
});

document.addEventListener('DOMContentLoaded', () => {
    const thumbnailWrapper = document.getElementById('thumbnail-wrapper');
    const audio = document.getElementById('audio-player');
    const playIcon = document.getElementById('play-icon');
    const pauseIcon = document.getElementById('pause-icon');

    thumbnailWrapper.addEventListener('click', () => {
        if (audio.paused) {
            playAudio();
        } else {
            pauseAudio();
        }
    });

    function playAudio() {
        playIcon.style.display = 'block';
        playIcon.style.opacity = '1';
        playIcon.style.transform = 'translate(-50%, -50%) scale(1.5)';
        setTimeout(() => {
            playIcon.style.opacity = '0';
            playIcon.style.transform = 'translate(-50%, -50%) scale(2)';
        }, 100);

        setTimeout(() => {
            playIcon.style.display = 'none';
        }, 1000);

        audio.play();
    }

    function pauseAudio() {
        pauseIcon.style.display = 'block';
        pauseIcon.style.opacity = '1';
        pauseIcon.style.transform = 'translate(-50%, -50%) scale(1.5)';
        setTimeout(() => {
            pauseIcon.style.opacity = '0';
            pauseIcon.style.transform = 'translate(-50%, -50%) scale(2)';
        }, 100);

        setTimeout(() => {
            pauseIcon.style.display = 'none';
        }, 1000);

        audio.pause();
    }
});

function setTime(time) {
    var audio = document.getElementById('audio-player');
    audio.currentTime = time;
    audio.play();
}

document.addEventListener('DOMContentLoaded', () => {
    const albumGrid = document.getElementById('album-grid');
    const albums = Array.from(albumGrid.getElementsByClassName('album'));

    albums.sort((a, b) => {
        return parseInt(b.getAttribute('data-index')) - parseInt(a.getAttribute('data-index'));
    });

    albums.forEach(album => {
        albumGrid.appendChild(album);
    });
});
