
// All page modals
var modals = document.querySelectorAll('.modal');

// When the user clicks anywhere outside of the modal, close it
window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
     for (var index in modals) {
      if (typeof modals[index].style !== 'undefined') modals[index].style.display = "none";    
     }
    }
}


var menuBoxes = document.getElementsByClassName('topnavitem');


for (var i = 0; i < menuBoxes.length; i++) {
    menuBoxes[i].onmouseover = function (e) {

        var color = '#' + Math.floor(Math.random() * 16777215).toString(16);
        var colorString = '0px 0px 10px 1px' + color;
        this.style['box-shadow'] = colorString;
        this.style['background-color'] = colorString;

    }
    menuBoxes[i].onmouseout = function (e) {
        this.style['box-shadow'] = "none";

    }


}


function closeAllModals() {
    for (var index in modals) {
      if (typeof modals[index].style !== 'undefined') modals[index].style.display = "none";    
    }
  }


document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
      closeAllModals();
    }
  });









  document.addEventListener('DOMContentLoaded', () => {
    const modalButtons = document.querySelectorAll('.modal-button');

    modalButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const modalTarget = button.getAttribute('data-modal-target');
            const modalContainer = document.querySelector(modalTarget);
            const modalId = button.id;
            if (!modalContainer.classList.contains('loaded')) {
                fetch(`${modalId}_modal_content.html`) // Adjust the path accordingly
                    .then(response => response.text())
                    .then(data => {
                        modalContainer.innerHTML = data;
                        modalContainer.classList.add('loaded');
                        attachCloseEvent(modalContainer); // Attach close event to the span
                        showModal(modalContainer); // Show the modal
                    })
                    .catch(error => console.error(error));
            } else {
                showModal(modalContainer); // Show the modal
            }
        });
    });

    // Attach event listeners to filter buttons
    const filterButtons = document.querySelectorAll('.filter-btn');
    filterButtons.forEach(button => {
         button.addEventListener('click', function() {
        // Toggle active state for buttons
         const isActive = button.classList.contains('active');
         filterButtons.forEach(btn => btn.classList.remove('active')); // Remove active class from all buttons
         if (!isActive) {
        button.classList.add('active'); // Only set this button as active if it was not active before
    }
      
      // Filter modals based on the selected category
      const category = isActive ? '' : button.getAttribute('data-category'); // If the button was already active, clear the filter
      filterModals(category);
    });
  });
  
  function filterModals(category) {
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
      if (category === '' || modal.getAttribute('data-categories').split(' ').includes(category)) {
        modal.style.display = 'block'; // Show modal
      } else {
        modal.style.display = 'none'; // Hide modal
      }
    });
  }

    function attachCloseEvent(modalElement) {
        // Find all the close buttons inside the modalElement and attach a click event listener
        modalElement.querySelectorAll('.close').forEach(closeButton => {
            closeButton.addEventListener('click', () => {
                hideModal(modalElement);
            });
        });
    }

    function showModal(modalElement) {
        modalElement.style.display = 'block';
        // You may need additional code to handle the background or modal animations
    }

    function hideModal(modalElement) {
        modalElement.style.display = 'none';
        // Additional code for hiding animations, if necessary
    }

    // Attach hide function to a close button (example)
    const closeButtons = document.querySelectorAll('.close-modal-button');
    closeButtons.forEach(button => {
        button.addEventListener('click', () => {
            const modal = button.closest('.modal');
            hideModal(modal);
        });
    });
});





document.getElementById("controlGAN").addEventListener("click", function() {
    // Code to open the modal
    // ...

    setTimeout(function() {
        var video = document.getElementById("myVideo");
        var slider = document.getElementById("videoSlider");
        var bufferedSlider = document.getElementById("bufferedSlider");
    
        function updateLoadingProgress() {
            if (video.buffered.length > 0) {
                // Log each buffered range (start and end)
                for (let i = 0; i < video.buffered.length; i++) {
                    console.log(`Range ${i}: ${video.buffered.start(i)} - ${video.buffered.end(i)}`);
                }
        
                // Update logic for the buffered progress
                var bufferEnd = video.buffered.end(video.buffered.length - 1);
                var bufferedPercent = (bufferEnd / video.duration) * 100;
                console.log(`Buffered Percent: ${bufferedPercent}%`); // Log buffered percent
                bufferedSlider.style.backgroundSize = bufferedPercent + '% 100%';
            }
        }
        
    
        video.addEventListener('timeupdate', updateLoadingProgress);
        video.addEventListener('loadedmetadata', function() {
            slider.max = video.duration;
            bufferedSlider.max = video.duration; // Set max of buffered slider to video duration
            updateLoadingProgress(); // Initial call to set the initial state
        });
    
        video.ontimeupdate = function() {
            slider.value = video.currentTime;
        };
    
        slider.oninput = function() {
            video.currentTime = slider.value;
        };
    }, 1000); // 1000 milliseconds delay
    
})    






