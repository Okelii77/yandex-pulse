#![no_std]
use core::panic::PanicInfo;
#[panic_handler]fn panic(_:&PanicInfo)->!{loop{}}
static mut BUFFER:[u32;8192]=[0;8192];
#[no_mangle]pub extern "C" fn buf()->*mut u32{core::ptr::addr_of_mut!(BUFFER).cast::<u32>()}
#[no_mangle]pub extern "C" fn sum(n:u32)->u32{if n>8192{return 0}let mut s=0u32;for i in 0..n as usize{s=s.wrapping_add(unsafe{buf().add(i).read()});}s}
