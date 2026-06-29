document.addEventListener('DOMContentLoaded', () => {
    const searchBar = document.getElementById('search-bar');
    const dropdownLinks = document.querySelectorAll('.dropdown-content a');
    const albumGrid = document.getElementById('album-grid');
    const albums = albumGrid ? Array.from(albumGrid.getElementsByClassName('album')) : [];

    if (searchBar && albumGrid && albums.length > 0) {
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

            const gridColumns = Math.max(1, Math.min(visibleAlbums, 5));
            albumGrid.style.gridTemplateColumns = `repeat(${gridColumns}, 1fr)`;
        });

        dropdownLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();

                if (link.classList.contains('order')) {
                    document.querySelectorAll('.order').forEach(orderLink => orderLink.classList.remove('selected'));
                    order = link.getAttribute('data-order') === 'asc' ? 1 : -1;
                } else {
                    document.querySelectorAll('[data-sort]').forEach(sortLink => sortLink.classList.remove('selected'));
                    sortBy = link.getAttribute('data-sort');
                }

                link.classList.add('selected');
                sortAlbums();
            });
        });

        const defaultSort = document.querySelector('[data-sort="index"]');
        const defaultOrder = document.querySelector('[data-order="desc"]');
        if (defaultSort) defaultSort.classList.add('selected');
        if (defaultOrder) defaultOrder.classList.add('selected');

        function sortAlbums() {
            albums.sort((a, b) => {
                let valA = a.dataset[sortBy] || '';
                let valB = b.dataset[sortBy] || '';

                if (sortBy === 'index') {
                    valA = parseInt(valA, 10) || 0;
                    valB = parseInt(valB, 10) || 0;
                } else if (sortBy === 'date') {
                    valA = new Date(valA);
                    valB = new Date(valB);
                } else if (sortBy === 'duration') {
                    const durationA = String(valA).split(':').reduce((acc, time) => (60 * acc) + Number(time || 0), 0);
                    const durationB = String(valB).split(':').reduce((acc, time) => (60 * acc) + Number(time || 0), 0);

                    if (durationA !== durationB) {
                        return durationA > durationB ? order : -order;
                    }

                    const dateA = new Date(a.dataset.date || 0);
                    const dateB = new Date(b.dataset.date || 0);
                    return dateA - dateB;
                } else if (sortBy === 'artist') {
                    const artistA = String(valA).toLowerCase();
                    const artistB = String(valB).toLowerCase();

                    if (artistA !== artistB) {
                        return artistA > artistB ? order : -order;
                    }

                    const dateA = new Date(a.dataset.date || 0);
                    const dateB = new Date(b.dataset.date || 0);
                    return dateA - dateB;
                } else {
                    valA = String(valA).toLowerCase();
                    valB = String(valB).toLowerCase();
                }

                return valA > valB ? order : -order;
            });

            albums.forEach(album => albumGrid.appendChild(album));
        }

        sortAlbums();
    }

    const thumbnailWrapper = document.getElementById('thumbnail-wrapper');
    const audio = document.getElementById('audio-player');
    const playIcon = document.getElementById('play-icon');
    const pauseIcon = document.getElementById('pause-icon');

    if (thumbnailWrapper && audio && playIcon && pauseIcon) {
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
    }
});

function setTime(time) {
    const audio = document.getElementById('audio-player');
    if (!audio) return;
    audio.currentTime = time;
    audio.play();
}
