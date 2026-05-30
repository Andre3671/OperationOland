import { ref, onMounted, onBeforeUnmount } from 'vue'

export function useGeolocation(){
  const coords = ref(null)
  const watchId = ref(null)
  const watchError = ref(null)

  function success(pos){
    coords.value = pos.coords
  }
  function error(err){
    watchError.value = err
  }

  onMounted(()=>{
    if ('geolocation' in navigator){
      try{
        watchId.value = navigator.geolocation.watchPosition(success,error,{enableHighAccuracy:true,maximumAge:5000,timeout:10000})
      }catch(e){
        watchError.value = e
      }
    } else {
      watchError.value = new Error('Geolocation not supported')
    }
  })

  onBeforeUnmount(()=>{
    if (watchId.value != null) navigator.geolocation.clearWatch(watchId.value)
  })

  return { coords, watchError }
}
