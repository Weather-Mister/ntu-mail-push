cmake_minimum_required(VERSION 3.22)
project(NTUScope VERSION 2.0 LANGUAGES CXX)

if(NOT WIN32)
  message(FATAL_ERROR "NTUScope requires Windows WASAPI.")
endif()

add_executable(NTUScope native/main.cpp)
target_compile_features(NTUScope PRIVATE cxx_std_17)
set_property(TARGET NTUScope PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
if(MSVC)
  target_compile_options(NTUScope PRIVATE /W4 /EHsc /utf-8)
endif()
target_link_libraries(NTUScope PRIVATE ole32 uuid ws2_32 bcrypt crypt32 shell32)
